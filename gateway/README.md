# Cryptophic Gateway

Express + TypeScript. Проксирует OpenAI-совместимые запросы в LiteLLM,
аутентифицирует клиентов по API-ключам (Postgres + Drizzle).

Текущий этап (Stage 3): проксирование + auth по API-ключам. **Биллинга/проверки
баланса ещё нет** (Stage 4).

## Запуск через docker compose (рекомендуется)

Весь стек (postgres + litellm + gateway) одной командой из корня репозитория,
читая один общий `.env`:

```bash
cp .env.example .env   # из корня репо: GEMINI_API_KEY, ADMIN_TOKEN, POSTGRES_PASSWORD…
docker compose up -d --build
```

- gateway публикуется на `${GATEWAY_PORT:-8080}`
- внутри сети ходит в LiteLLM (`http://litellm:4000`) и Postgres (`postgres:5432`)
- стартует после healthcheck зависимостей; миграции накатывает сам на старте

## Bootstrap: первый юзер и ключ

Дашборд-аутхи (magic-link/passkey) пока нет — юзеров и ключи заводим через
admin-эндпоинты под `ADMIN_TOKEN` из `.env`:

```bash
curl -H "X-Admin-Token: $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"email":"me@example.com"}' http://localhost:8080/admin/users

curl -H "X-Admin-Token: $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"email":"me@example.com","name":"cli"}' http://localhost:8080/admin/keys
# -> {"id":...,"prefix":"cphc_...","key":"cphc_<RAW>"}   (raw показывается один раз!)
```

Дальше клиент ходит в proxy с этим ключом:

```bash
curl -H "Authorization: Bearer cphc_<RAW>" http://localhost:8080/v1/models
```

## Локальный dev (без docker для gateway)

```bash
docker compose up -d postgres litellm   # нужны postgres:5432 и litellm:4000
pnpm install
pnpm db:migrate                         # накатить миграции
pnpm dev                                # tsx watch, порт 8080
```

Конфиг читается из **корневого** `.env` (одно место для docker и dev).

## Эндпоинты

Публичные:
- `GET /health` → `{"status":"ok"}`

Admin (заголовок `X-Admin-Token` или `Authorization: Bearer <ADMIN_TOKEN>`):
- `POST /admin/users` `{ email }` → создать юзера
- `POST /admin/keys` `{ email, name? }` → выдать ключ (raw один раз)

Под API-ключом клиента (`Authorization: Bearer cphc_…`):
- `GET /v1/models`, `POST /v1/chat/completions` (вкл. `stream: true`)
- `GET /account/keys`, `POST /account/keys` `{ name? }`, `DELETE /account/keys/:id`

Без валидного ключа proxy и `/account/*` возвращают `401`. Master-ключ LiteLLM
клиенту не нужен — его подставляет сам gateway.

## API-ключи

Ключ = `cphc_` + 32 случайных байта (base64url). В БД хранится только **SHA-256-хеш**
(`key_hash`, уникальный индекс — прямой lookup). Сырой ключ показывается один раз
при создании. Отзыв — `revoked_at` (мягкое удаление).

## Скрипты

- `pnpm dev` — dev с авто-перезапуском (tsx watch)
- `pnpm build` — компиляция в `dist/`
- `pnpm start` — запуск собранного (`node dist/index.js`)
- `pnpm typecheck` — проверка типов
- `pnpm db:generate` — сгенерировать SQL-миграцию из `src/db/schema.ts`
- `pnpm db:migrate` — накатить миграции (drizzle)
