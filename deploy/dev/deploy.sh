#!/usr/bin/env bash
# Выкладка на дев-стенд. Адрес задан жестко, чтобы эта выкладка не могла попасть на прод.
# В отличие от deploy/deploy.sh берет рабочую копию: правки проверяются на стенде до коммита.
#
#   deploy/dev/deploy.sh

set -euo pipefail

SERVER=root@109.120.133.56
APP_DIR=/opt/rw-max-bot
COMPOSE="docker compose -f docker-compose.yml -f dev/docker-compose.yml --env-file $APP_DIR/.env"

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

# Образы собираются по очереди: параллельная распаковка общих слоев api и bot удваивает расход диска, и его не хватает
ssh "$SERVER" "cd $APP_DIR/src/deploy \
	&& $COMPOSE build web && $COMPOSE build api && $COMPOSE build bot \
	&& $COMPOSE up -d --remove-orphans \
	&& docker image prune -f >/dev/null \
	&& docker builder prune -f >/dev/null \
	&& $COMPOSE ps \
	&& df -h / | tail -1"
