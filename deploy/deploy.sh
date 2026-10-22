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

echo "== Выкладываю $(git rev-parse --short HEAD) на $SERVER"

ssh "$SERVER" "test -f $APP_DIR/.env" || {
	echo "На сервере нет $APP_DIR/.env: сначала deploy/server-setup.sh"
	exit 1
}

# Код заменяется целиком, чтобы на сервере не оставались удаленные файлы
git archive --format=tar HEAD | ssh "$SERVER" "rm -rf $APP_DIR/src.new && mkdir -p $APP_DIR/src.new && tar -x -C $APP_DIR/src.new \
	&& rm -rf $APP_DIR/src && mv $APP_DIR/src.new $APP_DIR/src \
	&& echo $(git rev-parse HEAD) > $APP_DIR/src/REVISION"

ssh "$SERVER" "cd $APP_DIR/src/deploy \
	&& docker compose --env-file $APP_DIR/.env up -d --build --remove-orphans \
	&& docker image prune -f >/dev/null \
	&& docker compose --env-file $APP_DIR/.env ps"
