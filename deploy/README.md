# Развертывание

Сервер: `87.242.88.90` (Ubuntu 24.04), домен `max-bot.rw-y.ru`. Все работает в Docker:

| Сервис     | Что делает | Наружу |
|------------|------------|--------|
| `web`      | Caddy: HTTPS (сертификат Let's Encrypt выпускается и продлевается сам), админка, прокси `/api` → API и `/webhook` → бот | 80, 443 |
| `api`      | API, единственный работает с БД; при старте применяет миграции и заливает контент в пустую БД | — |
| `bot`      | Бот в режиме webhook | — |
| `postgres` | PostgreSQL 16, данные в томе `rw-max-bot_pgdata` | — |

`/internal/*` (запросы бота к API) снаружи отвечает 404: бот ходит в API внутри docker-сети.

## Первый запуск

```bash
# 1. Docker, ufw (80, 443) и /opt/rw-max-bot/.env с секретами
ssh root@87.242.88.90 'bash -s' < deploy/server-setup.sh

# 2. Вписать токен бота
ssh root@87.242.88.90 'nano /opt/rw-max-bot/.env'      # BOT_TOKEN=...

# 3. Выложить текущий коммит
deploy/deploy.sh

# 4. Пользователь админки (пароль спросит в консоли)
ssh -t root@87.242.88.90 'cd /opt/rw-max-bot/src/deploy && docker compose --env-file ../../.env exec api node --import tsx src/cli/create-admin.ts admin'
```

Админка: https://max-bot.rw-y.ru

**Важно:** с боевым `BOT_TOKEN` бота нельзя запускать локально (`pnpm dev`). В режиме polling библиотека MAX
снимает все подписки на вебхук, и боевой бот перестанет получать сообщения до следующего перезапуска.
Для разработки нужен отдельный тестовый бот со своим токеном.

## Обновление

```bash
deploy/deploy.sh      # выкладывает HEAD; незакоммиченные правки не попадают на сервер
```

Код лежит в `/opt/rw-max-bot/src` и заменяется целиком, `.env` — в `/opt/rw-max-bot/.env` и не трогается.
Выложенный коммит — в `/opt/rw-max-bot/src/REVISION`.

## Обслуживание

```bash
ssh root@87.242.88.90
cd /opt/rw-max-bot/src/deploy
alias dc='docker compose --env-file /opt/rw-max-bot/.env'

dc ps                       # состояние
dc logs -f bot              # журнал бота (api, web, postgres — так же)
dc restart bot
dc exec -T postgres pg_dump -U rw rw_max_bot > /root/backup-$(date +%F).sql     # резервная копия БД
```

Журналы приложений также пишутся в том `rw-max-bot_logs` (`api.log`, `bot.log`, `*-error.log`).
