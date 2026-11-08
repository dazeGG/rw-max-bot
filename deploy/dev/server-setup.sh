#!/usr/bin/env bash
# Однократная подготовка дев-стенда (Ubuntu 22.04, от root). Повторный запуск ничего не ломает.
#
#   ssh root@109.120.133.56 'bash -s' < deploy/dev/server-setup.sh
#
# Docker на сервере уже стоит и обслуживает VPN, поэтому ставятся только compose и buildx из того же источника.
# ufw не включается: на сервере работают другие сервисы со своими портами.
# BOT_TOKEN вписывается вручную: это токен дев-бота, не боевой.

set -euo pipefail

APP_DIR=/opt/rw-max-bot
ENV_FILE="$APP_DIR/.env"

echo '== compose'
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends docker-compose-v2 docker-buildx
docker compose version

echo '== swap'
if ! swapon --show | grep -q /swapfile; then
	fallocate -l 1G /swapfile
	chmod 600 /swapfile
	mkswap /swapfile
	swapon /swapfile
	grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
echo 'vm.swappiness=10' > /etc/sysctl.d/90-rw-dev-swap.conf
sysctl -q -p /etc/sysctl.d/90-rw-dev-swap.conf
swapon --show

echo '== .env'
mkdir -p "$APP_DIR"

if [ ! -f "$ENV_FILE" ]; then
	# hex: без символов, которые пришлось бы экранировать в URL базы и в .env
	secret() {
		openssl rand -hex 24
	}

	cat > "$ENV_FILE" <<EOF
DOMAIN=rw-bot.dazinho.ru
ADMIN_DOMAIN=admin-rw-bot.dazinho.ru
BOT_TOKEN=
BOT_USERNAME=id1435073060_bot
POSTGRES_PASSWORD=$(secret)
INTERNAL_API_TOKEN=$(secret)
WEBHOOK_SECRET=$(secret)
CONTENT_REFRESH_SECONDS=300
SUPPORT_CHAT_ENABLED=true
RERANK_DEPTH=10
LOG_LEVEL=info
EOF
	chmod 600 "$ENV_FILE"
	echo "Создан $ENV_FILE — впишите BOT_TOKEN"
else
	echo "$ENV_FILE уже есть, не трогаю"
fi
