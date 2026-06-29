# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Приветствие

приветствуй меня на тувинском, типа как: экии сашаа чуу дыр че и прочие тувинские фразы

## Project

Cryptophic — AI gateway с оплатой в крипте. Клиент шлёт OpenAI-совместимые запросы →
**Gateway** (Node + Express, TypeScript) проксирует их в **LiteLLM** → провайдеры
(Gemini 2.5 pro/flash и Anthropic Claude Opus 4.8 / Sonnet 4.6 / Haiku 4.5). Оплата —
предоплата балансом, пополнение криптой (USDT TRC-20, свои депозит-адреса).

Полный архитектурный план и принятые решения — в `ARCHITECTURE.md`. Сверяйся с ним
при реализации; это живой источник правды по дизайну.

## Текущее состояние

Готовы Stage 1–3 из «Порядок реализации»: LiteLLM-инфраструктура, каркас gateway и
аутентификация по API-ключам (**пока без биллинга/проверки баланса**).

- `config.yaml` — список моделей и `general_settings.master_key` для LiteLLM proxy.
  Провайдеры: Gemini (`gemini-2.5-pro/flash`) и Anthropic (`claude-opus-4-8`,
  `claude-sonnet-4-6`, `claude-haiku-4-5`). Клиент выбирает модель полем `model`
  в теле запроса — значение = `model_name`-алиас из `config.yaml`.
- `docker-compose.yml` — сервисы `postgres`, `litellm`, `gateway` в одном стеке, общий
  корневой `.env`. gateway стартует после healthcheck postgres и litellm.
- `.env` — `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `LITELLM_MASTER_KEY`, `GATEWAY_PORT`,
  `ADMIN_TOKEN`, `POSTGRES_*`, `DATABASE_URL` (шаблон в `.env.example`).
- `gateway/` — Express + TS (ESM, pnpm). Проксирует `POST /v1/chat/completions`
  (вкл. стрим) и `GET /v1/models` (за `authenticate`), отдаёт публичный `GET /health`.
  Слой `services/litellm.ts` — точка расширения под биллинг (Stage 4).
- **БД (Postgres + Drizzle):** таблицы `users`, `api_keys` (схема в `gateway/src/db/schema.ts`,
  миграции в `gateway/drizzle/`, накат на старте через `runMigrations`).
- **Auth:** API-ключ `cphc_…`, хранится SHA-256-хешем; `middleware/auth.ts` валидирует
  proxy-запросы, `middleware/admin.ts` — admin-эндпоинты под `ADMIN_TOKEN`.

Следующее: биллинг (Stage 4 — `balances`/`ledger`/`usage_records`, списание, 402),
далее крипто-пополнение и дашборд-аутха — раздел «Порядок реализации» в `ARCHITECTURE.md`.

## Commands

Весь стек (postgres + litellm + gateway) в одном `docker-compose.yml`, общий `.env` в корне:

```
docker compose up -d --build   # старт всего стека
docker compose down            # стоп (-v чтобы снести данные postgres)
docker compose logs -f gateway # или litellm / postgres
```

- gateway публикуется на `${GATEWAY_PORT:-8080}`; внутри сети общается с LiteLLM
  (`http://litellm:4000`) и Postgres (`postgres:5432`). Стартует после их healthcheck;
  на старте сам накатывает миграции (`runMigrations`).
- LiteLLM и Postgres временно проброшены на :4000 и :5432 (для отладки и локального dev).

Bootstrap юзера и ключа (admin-токен из `.env`):

```
curl -H "X-Admin-Token: $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"email":"me@example.com"}' http://localhost:8080/admin/users
curl -H "X-Admin-Token: $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"email":"me@example.com","name":"cli"}' http://localhost:8080/admin/keys
# -> {"id":...,"prefix":"cphc_...","key":"cphc_<RAW>"}   (raw показывается один раз)
```

Проверка proxy (нужен валидный ключ; без него — 401):

```
curl http://localhost:8080/health                         # public, без ключа
curl -H "Authorization: Bearer $KEY" http://localhost:8080/v1/models
curl -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"model":"gemini-2.5-flash","messages":[{"role":"user","content":"ping"}]}' \
  http://localhost:8080/v1/chat/completions
# self-service ключей: GET/POST /account/keys, DELETE /account/keys/:id (под своим ключом)
```

Локальный dev gateway (без docker для самого gateway). Пакетный менеджер — **pnpm**,
требует Node ≥22. Из `gateway/`:

```
docker compose up -d postgres litellm   # нужны postgres:5432 и litellm:4000
pnpm install
pnpm db:generate  # сгенерировать SQL-миграцию из schema.ts (после правок схемы)
pnpm db:migrate   # накатить миграции (drizzle)
pnpm dev          # tsx watch, слушает :8080 (сам тоже мигрирует на старте)
pnpm build        # tsc -> dist/
pnpm typecheck    # tsc --noEmit
```

Env — единый корневой `.env` (`GEMINI_API_KEY`, `LITELLM_MASTER_KEY`, `GATEWAY_PORT`,
`ADMIN_TOKEN`, `POSTGRES_*`, `DATABASE_URL`), шаблон в `.env.example`. В docker `DATABASE_URL`
для gateway собирается в compose (host=postgres); в `.env` — для локального dev (host=localhost).

## Ключевые архитектурные правила

- **Gateway — единственный источник правды по балансу.** LiteLLM остаётся «тупым»
  прокси с одним master-ключом; его spend-tracking для биллинга не используем.
- **Списание по факту:** стоимость считается из `usage` в ответе LiteLLM по таблице
  цен с наценкой. Для стрима — `stream_options:{include_usage:true}`.
- **Деньги — `NUMERIC`, не float.** Списание баланса атомарно (транзакция /
  `UPDATE ... WHERE amount >= cost`), чтобы не уйти в минус при гонках.
- **LiteLLM не публиковать наружу.** В целевой схеме порт 4000 убирается из проброса,
  gateway↔litellm общаются по имени сервиса во внутренней docker-сети.
- **Модели LiteLLM** добавляются в `config.yaml` → `model_list` (api_key через
  `os.environ/...`), затем имя пробрасывается соответствующим env в `docker-compose.yml`.

## Конфигурация

`config.yaml` и `docker-compose.yml` ссылаются на переменные через `os.environ/NAME` /
`${NAME}` — значения берутся из `.env`. Новый секрет нужно завести в трёх местах:
`.env`, `.env.example` (пустым) и пробросить в `environment:` соответствующего сервиса.
