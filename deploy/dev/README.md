# Дев-стенд

Сервер `109.120.133.56`, дев-бот и админка. Схема как у заказчика: вебхук и админка на разных адресах.

| Адрес | Что на нем |
|-------|------------|
| `rw-bot.dazinho.ru` | только `/webhook`, остальное 404 |
| `admin-rw-bot.dazinho.ru` | админка и `/api` |

На стенде только начальный контент и тестовые пользователи: дампы прода сюда не загружаются, сервер находится за рубежом.
Админку защищает только вход, внешнего контура заказчика здесь нет.

На этом же сервере работают VPN и другие боты. Их не трогать, ufw не включать.

## Выкладка

```bash
ssh root@109.120.133.56 'bash -s' < deploy/dev/server-setup.sh   # один раз, затем вписать BOT_TOKEN в /opt/rw-max-bot/.env
deploy/dev/deploy.sh                                             # рабочая копия, включая незакоммиченные правки
```

## Обслуживание

```bash
ssh root@109.120.133.56
cd /opt/rw-max-bot/src/deploy
alias dc='docker compose -f docker-compose.yml -f dev/docker-compose.yml --env-file /opt/rw-max-bot/.env'

dc ps
dc logs -f bot
dc exec api node --import tsx src/cli/create-admin.ts admin   # создать суперадмина или сбросить ему пароль
```
