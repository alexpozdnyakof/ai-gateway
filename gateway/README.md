# Cryptophic Gateway

Express + TypeScript каркас. Проксирует OpenAI-совместимые запросы в LiteLLM.

Текущий этап (Stage 2): только проксирование, **без биллинга и аутентификации**.

## Запуск через docker compose (рекомендуется)

Весь стек (LiteLLM + gateway) поднимается одной командой из корня репозитория,
читая один общий `.env`:

```bash
cp .env.example .env   # из корня репо, заполни GEMINI_API_KEY и т.д.
docker compose up -d --build
```

- gateway публикуется на `${GATEWAY_PORT:-8080}`
- gateway ходит в LiteLLM по внутренней docker-сети (`http://litellm:4000`)
- gateway стартует только после healthcheck LiteLLM

## Локальный dev (без docker для gateway)

LiteLLM всё равно нужен в docker; gateway запускается через tsx:

```bash
docker compose up -d litellm      # только LiteLLM на :4000
pnpm install
pnpm dev                          # tsx watch, порт 8080
```

Конфиг читается из **корневого** `.env` (одно место для docker и dev).

## Эндпоинты

- `GET /health` → `{"status":"ok"}`
- `GET /v1/models` → список моделей из LiteLLM
- `POST /v1/chat/completions` → проксирование в LiteLLM (вкл. `stream: true`)

Клиент обращается к gateway **без** `Authorization` — master-ключ LiteLLM
подставляет сам gateway.

## Скрипты

- `pnpm dev` — dev-режим с авто-перезапуском (tsx watch)
- `pnpm build` — компиляция в `dist/`
- `pnpm start` — запуск собранного (`node dist/index.js`)
- `pnpm typecheck` — проверка типов без сборки
