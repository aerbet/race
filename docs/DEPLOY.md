# Выкладка игры на сервер

Всё работает на одном сервере через Docker Compose. Игра, API, оплаты и онлайн-гонки живут на одном домене:

| Путь | Куда |
|---|---|
| `https://<домен>/` | клиент (статика) |
| `/api/…` | API (Spring Boot) |
| `/webhooks/…` | уведомления платёжных систем и бота Telegram |
| `/ws` | WebSocket сервера гонок |

HTTPS-сертификат Caddy выпускает сам.

## Что нужно

- Сервер с Linux: от 2 ядер и 4 ГБ памяти. Сборка образов занимает примерно 10 минут.
- Docker и плагин Compose.
- Домен с A-записью на IP сервера.
- Открытые порты 80 и 443.

## Первый запуск

1. Скачать репозиторий на сервер:
   ```bash
   git clone https://github.com/aerbet/race.git
   ```
2. Перейти в папку проекта:
   ```bash
   cd race
   ```
3. Создать файл настроек из образца:
   ```bash
   cp deploy/.env.example deploy/.env
   ```
4. Заполнить `deploy/.env`. Секреты генерируются так:
   ```bash
   openssl rand -hex 32
   ```
   - `DOMAIN`, `DB_PASSWORD`, `JWT_SECRET` (не короче 32 символов), `INTERNAL_KEY` (не короче 16) — обязательны. Без них API в продакшене не стартует: это проверяет `SecretsGuard`.
   - Telegram, Crypto Pay и ЮKassa — по желанию. Пустое значение выключает соответствующую функцию.
5. Запустить:
   ```bash
   docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build
   ```
6. Проверить, что API отвечает (должно вернуться `{"ok":true}`):
   ```bash
   curl https://<домен>/api/health
   ```

Миграции базы (Flyway) применяются сами при старте API.

## Обновление

1. Получить свежий код:
   ```bash
   git pull
   ```
2. Пересобрать и перезапустить:
   ```bash
   docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build
   ```

## Telegram

1. **Бот.** Создать бота у @BotFather и записать токен в `TELEGRAM_BOT_TOKEN`. Этот же бот используется для входа, Mini App и оплаты звёздами.
2. **Вебхук для оплаты Stars.** Придумать секрет (`openssl rand -hex 16`) и записать его в `TELEGRAM_WEBHOOK_SECRET`, затем выполнить один раз:
   ```bash
   curl "https://api.telegram.org/bot<ТОКЕН>/setWebhook" -d url=https://<домен>/webhooks/telegram -d secret_token=<СЕКРЕТ> -d 'allowed_updates=["message","pre_checkout_query"]'
   ```
3. **Mini App.** В @BotFather выполнить `/newapp` (или Bot Settings → Menu Button) и указать адрес `https://<домен>/`. Внутри Telegram игрок входит автоматически.
4. **Вход на сайте через Telegram.** В @BotFather выполнить `/setdomain` и указать домен.

## Резервные копии

Все данные игроков лежат в PostgreSQL. Ежедневный дамп:
```bash
docker compose -f deploy/docker-compose.yml exec -T db pg_dump -U racer racer | gzip > backup-$(date +%F).sql.gz
```

## Что не проверено

Образы не собирались в среде разработки Claude: там запрещено скачивать базовые образы Docker. Проверено только то, что выполняется внутри образов:
- сборка API (`mvn package`);
- сборка клиента с `VITE_API_URL=same-origin`;
- запуск сервера гонок с `NODE_ENV=production`.

Первую сборку на сервере стоит провести внимательно и прислать ошибки, если они будут.
