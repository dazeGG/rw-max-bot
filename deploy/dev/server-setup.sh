#!/usr/bin/env bash
# Однократная подготовка дев-стенда на сервере войсрума (Ubuntu 22.04). Повторный запуск ничего не ломает.
#
#   ssh daze@193.233.91.146 'bash -s' < deploy/dev/server-setup.sh
#
# Работает от пользователя daze без sudo: ему хватает группы docker. Docker и compose уже стоят, их обслуживает войсрум.
# Порты 80 и 443 у Caddy войсрума, наши сайты подключает deploy/dev/deploy.sh.
# Токен дев-бота берется из ~/rw-bot-token, если пользователь его туда положил; иначе вписать BOT_TOKEN в .env вручную.

set -euo pipefail

APP_DIR=$HOME/rw-max-bot
ENV_FILE=$APP_DIR/.env

docker compose version

mkdir -p "$APP_DIR"

if [ ! -f "$ENV_FILE" ]; then
	# hex: без символов, которые пришлось бы экранировать в URL базы и в .env
	secret() {
		openssl rand -hex 24
	}

	token=$(cat "$HOME/rw-bot-token" 2>/dev/null || true)

	(
		umask 077
		cat > "$ENV_FILE" <<EOF
DOMAIN=rw-bot.dazinho.ru
ADMIN_DOMAIN=admin-rw-bot.dazinho.ru
BOT_TOKEN=$token
BOT_USERNAME=id1435073060_bot
POSTGRES_PASSWORD=$(secret)
INTERNAL_API_TOKEN=$(secret)
WEBHOOK_SECRET=$(secret)
CONTENT_REFRESH_SECONDS=300
SUPPORT_CHAT_ENABLED=true
# Сервер общий с голосовым сервисом: реранкер занял бы почти всю свободную память
RERANK_DEPTH=0
LOG_LEVEL=info
EOF
	)

	if [ -n "$token" ]; then
		echo "Создан $ENV_FILE, токен взят из ~/rw-bot-token"
	else
		echo "Создан $ENV_FILE — впишите BOT_TOKEN"
	fi
else
	echo "$ENV_FILE уже есть, не трогаю"
fi
