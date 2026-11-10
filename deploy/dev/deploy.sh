#!/usr/bin/env bash
# Выкладка на дев-стенд. Адрес задан жестко, чтобы эта выкладка не могла попасть на прод.
# В отличие от deploy/deploy.sh берет рабочую копию: правки проверяются на стенде до коммита.
#
#   deploy/dev/deploy.sh

set -euo pipefail

SERVER=daze@193.233.91.146
APP_DIR=/home/daze/rw-max-bot
COMPOSE="docker compose -f docker-compose.yml -f dev/docker-compose.yml --env-file $APP_DIR/.env"
# Наши сайты подключаются к Caddy войсрума файлом в его рабочей копии: выкладки войсрума его не трогают
VOICEROOM_SITE=/home/daze/VoiceRoom/config/caddy/sites.d/rw-max-bot.caddy
VOICEROOM_CADDY=voiceroom-caddy-1

cd "$(dirname "$0")/../.."

ssh "$SERVER" "test -f $APP_DIR/.env" || {
	echo "На сервере нет $APP_DIR/.env: сначала deploy/dev/server-setup.sh"
	exit 1
}

revision=$(git rev-parse HEAD)
if ! git diff --quiet HEAD || [ -n "$(git ls-files -o --exclude-standard)" ]; then
	revision="$revision-dirty"
fi

echo "== Собираю админку"
pnpm --filter @rw/admin build

echo "== Выкладываю $revision на $SERVER"

# Файлы рабочей копии без игнорируемых; удаленные, но еще не закоммиченные, пропускаются
git ls-files -co --exclude-standard -z \
	| while IFS= read -r -d '' file; do if [ -e "$file" ]; then printf '%s\0' "$file"; fi; done \
	| tar --null -T - -cf - \
	| ssh "$SERVER" "rm -rf $APP_DIR/src.new && mkdir -p $APP_DIR/src.new && tar -x -C $APP_DIR/src.new \
		&& rm -rf $APP_DIR/src && mv $APP_DIR/src.new $APP_DIR/src \
		&& echo $revision > $APP_DIR/src/REVISION"

tar -C apps/admin/dist -cf - . \
	| ssh "$SERVER" "mkdir -p $APP_DIR/src/deploy/dev/admin-dist && tar -x -C $APP_DIR/src/deploy/dev/admin-dist"

# Образы собираются по очереди: параллельная распаковка общих слоев api и bot удваивает расход диска
ssh "$SERVER" "cd $APP_DIR/src/deploy \
	&& $COMPOSE build web && $COMPOSE build api && $COMPOSE build bot \
	&& $COMPOSE up -d --remove-orphans \
	&& docker image prune -f >/dev/null \
	&& docker builder prune -f >/dev/null \
	&& $COMPOSE ps"

echo "== Сайты на Caddy войсрума"

# Ошибка в файле сайтов не дала бы Caddy войсрума запуститься, поэтому новый файл сначала проверяется
# вместе со всем конфигом, а при ошибке возвращается прежний
ssh "$SERVER" "set -e
	if ! docker exec $VOICEROOM_CADDY test -d /etc/caddy/sites.d; then
		echo 'Caddy войсрума еще не подключает внешние сайты (нужен релиз войсрума с config/caddy/sites.d): пропускаю'
		exit 0
	fi
	new=$APP_DIR/src/deploy/dev/voiceroom-sites.caddy
	if cmp -s \"\$new\" $VOICEROOM_SITE; then
		echo 'Файл сайтов не изменился'
		exit 0
	fi
	backup=\$(mktemp)
	if [ -f $VOICEROOM_SITE ]; then cp $VOICEROOM_SITE \"\$backup\"; else rm -f \"\$backup\"; fi
	cp \"\$new\" $VOICEROOM_SITE
	if ! docker exec $VOICEROOM_CADDY caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null; then
		if [ -f \"\$backup\" ]; then cp \"\$backup\" $VOICEROOM_SITE; else rm -f $VOICEROOM_SITE; fi
		echo 'Конфиг Caddy войсрума с новым файлом сайтов не проходит проверку: вернул прежний' >&2
		exit 1
	fi
	rm -f \"\$backup\"
	docker exec $VOICEROOM_CADDY caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
	echo 'Caddy войсрума перечитал сайты'"

ssh "$SERVER" "df -h / | tail -1"
