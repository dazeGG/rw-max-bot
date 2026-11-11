#!/usr/bin/env bash
# Выкладка текущего коммита на сервер: код → /opt/rw-max-bot/src, сборка образов и перезапуск.
# Незакоммиченные правки не выкладываются (git archive HEAD).
#
#   deploy/deploy.sh                       # на root@87.242.88.90
#   SERVER=root@другой-сервер deploy/deploy.sh

set -euo pipefail

SERVER=${SERVER:-root@87.242.88.90}
APP_DIR=/opt/rw-max-bot

cd "$(dirname "$0")/.."

if ! git diff --quiet HEAD; then
	echo 'Внимание: есть незакоммиченные правки, они не попадут на сервер'
fi

ssh "$SERVER" "test -f $APP_DIR/.env" || {
	echo "На сервере нет $APP_DIR/.env: сначала deploy/server-setup.sh"
	exit 1
}

# Здесь, а не на сервере: без подкачки и с занятой ботом памятью сборка Vite мешала бы ему
echo "== Собираю админку"
pnpm --filter @rw/admin build

echo "== Выкладываю $(git rev-parse --short HEAD) на $SERVER"

# Код заменяется целиком, чтобы на сервере не оставались удаленные файлы
git archive --format=tar HEAD | ssh "$SERVER" "rm -rf $APP_DIR/src.new && mkdir -p $APP_DIR/src.new && tar -x -C $APP_DIR/src.new \
	&& rm -rf $APP_DIR/src && mv $APP_DIR/src.new $APP_DIR/src \
	&& echo $(git rev-parse HEAD) > $APP_DIR/src/REVISION"

tar -C apps/admin/dist -cf - . \
	| ssh "$SERVER" "mkdir -p $APP_DIR/src/deploy/admin-dist && tar -x -C $APP_DIR/src/deploy/admin-dist"

# Образы собираются по очереди: параллельная сборка рядом с работающим ботом не уложилась бы в память
COMPOSE="docker compose --env-file $APP_DIR/.env"
ssh "$SERVER" "cd $APP_DIR/src/deploy \
	&& $COMPOSE build web && $COMPOSE build dns && $COMPOSE build api && $COMPOSE build bot \
	&& $COMPOSE up -d --remove-orphans \
	&& docker image prune -f >/dev/null \
	&& $COMPOSE ps"
