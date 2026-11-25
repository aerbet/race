# Street Racer (рабочее название)

Аркадная ночная браузерная гонка: дрифт, нитро, боты, онлайн до 8 игроков.
ТЗ — `docs/SPEC.md`, план — `docs/PLAN.md`, решения — `docs/DECISIONS.md`, ассеты — `docs/ASSETS.md`.

## Запуск

```bash
pnpm install
pnpm dev        # клиент: http://localhost:5173
pnpm server     # сервер онлайн-гонок: ws://localhost:2567 (нужен только для онлайна)
```

Параметры адреса клиента:

| Параметр | Что делает |
|---|---|
| `?q=low` / `?q=high` | пресет качества (по умолчанию: телефон — low, ПК — high) |
| `?blind` | сборка для слепого теста управления |
| `?room=ABC123` | сразу войти в приватную онлайн-комнату |
| `?lag=150&jitter=30&loss=2` | симуляция плохой сети (мс, мс, %) |
| `?server=ws://host:port` | адрес сервера гонок (иначе `VITE_SERVER_URL` или `ws://<хост>:2567`) |
| `?debug` | панель значений всех устройств ввода |

Сервер гонок: `PORT`, `BOT_FILL` (секунды до добавления ботов, по умолчанию 30), `NET_LAG`, `NET_JITTER`, `NET_LOSS`,
`API_URL` (куда слать итоги гонок, напр. `http://localhost:8080`), `JWT_SECRET` (тот же, что у API), `INTERNAL_KEY`.

### API и метаигра (Java 21, PostgreSQL 16, Redis 7)

```bash
createdb racer            # пользователь/пароль по умолчанию racer/racer (см. apps/api/src/main/resources/application.yml)
pnpm api                  # http://localhost:8080
pnpm api:test             # JUnit на базе racer_test и Redis db 1
```

Переменные API: `DB_URL`, `DB_USER`, `DB_PASSWORD`, `REDIS_HOST`, `JWT_SECRET` (≥ 32 байт), `TELEGRAM_BOT_TOKEN`,
`INTERNAL_KEY`, `VERIFIER_URL` (по умолчанию `http://localhost:2567/verify` — сервер гонок), `CORS_ORIGINS`.
Клиент ищет API по `?api=…`, `VITE_API_URL` или `http(s)://<хост>:8080`. Без API игра работает в гостевом режиме.

### Город

```bash
pnpm --filter osm-to-city build -- --synth --id moscow_synth --name "Москва (процедурная)"
pnpm --filter osm-to-city build -- --bbox 55.744,37.585,55.762,37.617 --id moscow_arbat --name "Москва, Арбат"   # нужен доступ к overpass-api.de
```

## Управление

Клавиатура: W/↑ газ · S/↓ тормоз и задний ход · A/D руль · Пробел ручник · Shift нитро · C камера · R сброс на трассу · Esc пауза · Q/E передачи (ручная коробка) · F2 панель настройки машины с телеметрией.
Геймпад: левый стик — руль, R2/L2 — газ/тормоз, A — ручник, B/RB — нитро, Y/LB — передачи.
Телефон: экранные кнопки, газ автоматический, кнопка «ДРИФТ».

## Проверки

```bash
pnpm test       # Vitest: физика, детерминизм, гонка, протокол, сервер (≈90 тестов)
pnpm lint
pnpm typecheck
pnpm e2e        # дымовые тесты Playwright: меню, гонка, пауза, слепой тест, онлайн
pnpm build      # продакшн-сборка клиента в apps/client/dist
```

## Структура

- `packages/shared` — конфиги машин (zod), трассы (сплайны), гоночная логика, очки дрифта, протокол сети, проверки правдоподобия, симулятор сети.
- `packages/physics` — raycast vehicle на Rapier с аркадными помощниками, боты, мир уровня.
- `apps/client` — Vite + Three.js: рендер, ввод, HUD, звук, меню, призраки, онлайн-клиент.
- `apps/race-server` — Node + ws: комнаты, свободная езда, боты на сервере, авторитетный финиш, повтор заездов (`/verify`).
- `apps/api` — Spring Boot: вход (email, Telegram), гараж и тюнинг, экономика, рекорды (Redis), рейтинг Эло, онбординг.
- `tools/osm-to-city` — OpenStreetMap → блоки города 256 м (glb) + трассы.
