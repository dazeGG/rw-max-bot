#!/usr/bin/env bash
# Однократная подготовка сервера (Ubuntu 24.04, от root). Повторный запуск ничего не ломает.
#
#   ssh root@<сервер> 'bash -s' < deploy/server-setup.sh
#
# Ставит Docker, открывает в ufw 80 и 443 (выпуск сертификата и HTTPS) и создает
# /opt/rw-max-bot/.env со сгенерированными секретами. BOT_TOKEN вписывается вручную.

set -euo pipefail

APP_DIR=/opt/rw-max-bot
ENV_FILE="$APP_DIR/.env"

if ! command -v docker >/dev/null; then
	echo '== Docker'
	export DEBIAN_FRONTEND=noninteractive
	apt-get update
	apt-get install -y ca-certificates curl
	install -m 0755 -d /etc/apt/keyrings
	curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
	chmod a+r /etc/apt/keyrings/docker.asc
	echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
		> /etc/apt/sources.list.d/docker.list
	apt-get update
	apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

docker --version
docker compose version

echo '== ufw'
# Порты, опубликованные docker, ufw не фильтрует: наружу публикует только Caddy (80, 443).
# Правила здесь — чтобы ufw status показывал реальную картину
ufw allow 80/tcp comment 'http: Lets Encrypt, redirect'
ufw allow 443/tcp comment 'https'
ufw allow 443/udp comment 'http3'
ufw status

echo '== .env'
mkdir -p "$APP_DIR"

if [ ! -f "$ENV_FILE" ]; then
	# hex: без символов, которые пришлось бы экранировать в URL базы и в .env
	secret() {
		openssl rand -hex 24
	}

	cat > "$ENV_FILE" <<EOF
DOMAIN=max-bot.rw-y.ru
BOT_TOKEN=
POSTGRES_PASSWORD=$(secret)
INTERNAL_API_TOKEN=$(secret)
WEBHOOK_SECRET=$(secret)
CONTENT_REFRESH_SECONDS=30
LOG_LEVEL=info
EOF
	chmod 600 "$ENV_FILE"
	echo "Создан $ENV_FILE — впишите BOT_TOKEN"
else
	echo "$ENV_FILE уже есть, не трогаю"
fi
