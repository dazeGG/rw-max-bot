# Образы для сервера: api, bot и web (Caddy: HTTPS и вебхук бота). Админка в них не входит.
# Собираются из deploy/docker-compose.yml, контекст — корень репозитория.

FROM node:24-slim AS base
RUN npm install -g pnpm@12.8.1
# Генератор картинок (puppeteer) на сервере не нужен
ENV PUPPETEER_SKIP_DOWNLOAD=1
WORKDIR /app

# Сначала только манифесты: зависимости пересобираются, лишь когда они изменились
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/bot/package.json apps/bot/
COPY apps/admin/package.json apps/admin/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/runtime/package.json packages/runtime/

FROM manifests AS server
RUN pnpm install --frozen-lockfile --prod --filter "@rw/api..." --filter "@rw/bot..."
COPY packages packages
COPY apps/api apps/api
COPY apps/bot apps/bot
COPY media media
# REVISION (выложенный коммит) пишет deploy.sh; package.json — чтобы COPY не падал, если файла нет
COPY package.json REVISION* ./
# /models — том с весами E5 и реранкера: скачиваются при первом запуске бота и переживают выкладки
RUN mkdir -p logs /models && chown node:node logs /models
ENV NODE_ENV=production
USER node

# TypeScript запускается через tsx; node — первый процесс и сам получает SIGTERM от docker
FROM server AS api
WORKDIR /app/apps/api
CMD ["node", "--import", "tsx", "src/index.ts"]

FROM server AS bot
WORKDIR /app/apps/bot
CMD ["node", "--import", "tsx", "src/index.ts"]

FROM caddy:2.10-alpine AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
