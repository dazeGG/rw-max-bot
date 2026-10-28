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

### Немедленное обновление контента после SQL-правок

После успешного коммита изменений в БД вызовите внутренний метод API. Кнопки в админке нет.
На сервере из `/opt/rw-max-bot/src/deploy`:

```bash
docker compose --env-file /opt/rw-max-bot/.env exec -T api node --input-type=module <<'JS'
const response = await fetch('http://127.0.0.1:3001/internal/content/refresh', {
  method: 'POST',
  headers: { authorization: `Bearer ${process.env.INTERNAL_API_TOKEN}` },
});
console.log(response.status, await response.text());
if (!response.ok) process.exitCode = 1;
JS
```

API отправляет `POST http://bot:3002/internal/content/refresh`. Бот загружает контент через API,
затем возвращает `{ "ok": true, "version": "..." }`. Порт 3002 не опубликован наружу, оба метода
защищены `INTERNAL_API_TOKEN`; Caddy блокирует внешний `/internal/*`. При ошибке возвращается 503:
данные в БД не откатываются, бот сохраняет прежний кеш; можно повторить запрос или дождаться резервной проверки.

Резервный опрос — раз в 5 минут (`CONTENT_REFRESH_SECONDS=300`). При обновлении существующей установки
замените старое значение `CONTENT_REFRESH_SECONDS=30` в `/opt/rw-max-bot/.env` на `300` и пересоздайте
контейнер бота через `docker compose --env-file /opt/rw-max-bot/.env up -d bot`. Обычный `restart`
не применяет изменения переменных окружения. Для новой функциональности сначала нужна выкладка кода.

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
