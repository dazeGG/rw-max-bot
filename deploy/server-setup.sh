#!/usr/bin/env bash
# Однократная подготовка сервера (Ubuntu 24.04, от root). Повторный запуск ничего не ломает.
#
#   ssh root@<сервер> 'bash -s' < deploy/server-setup.sh
#
# Ставит Docker, открывает в ufw 80, 443 (выпуск сертификата и HTTPS) и 53 (проверка сертификата админки) и создает
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
# Порты, опубликованные docker, ufw не фильтрует: наружу публикуют только Caddy (80, 443) и DNS (53).
# Правила здесь — чтобы ufw status показывал реальную картину
ufw allow 80/tcp comment 'http: Lets Encrypt, redirect'
ufw allow 443/tcp comment 'https'
ufw allow 443/udp comment 'http3'
ufw allow 53/udp comment 'dns: admin certificate check'
ufw allow 53/tcp comment 'dns: admin certificate check'
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
ADMIN_DOMAIN=max-admin.rw-y.ru
ACME_DNS_BIND_IP=$(ip -4 -o route get 1.1.1.1 | sed -n 's/.* src \([0-9.]*\).*/\1/p')
ACME_TSIG_SECRET=$(openssl rand -base64 32)
BOT_TOKEN=
BOT_USERNAME=
POSTGRES_PASSWORD=$(secret)
INTERNAL_API_TOKEN=$(secret)
WEBHOOK_SECRET=$(secret)
CONTENT_REFRESH_SECONDS=30
LOG_LEVEL=info
EOF
	chmod 600 "$ENV_FILE"
	echo "Создан $ENV_FILE — впишите BOT_TOKEN и BOT_USERNAME"
else
	echo "$ENV_FILE уже есть, не трогаю"
fi
