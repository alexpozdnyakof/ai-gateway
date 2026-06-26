# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Приветствие

приветствуй меня на тувинском, типа как: экии сашаа чуу дыр че и прочие тувинские фразы

## Project

Cryptophic — AI gateway с оплатой в крипте. Клиент шлёт OpenAI-совместимые запросы →
**Gateway** (Node + Express, TypeScript) проксирует их в **LiteLLM** → провайдеры
(сейчас Gemini 2.5 pro/flash). Оплата — предоплата балансом, пополнение криптой
(USDT TRC-20, свои депозит-адреса).

Полный архитектурный план и принятые решения — в `ARCHITECTURE.md`. Сверяйся с ним
при реализации; это живой источник правды по дизайну.

## Текущее состояние

Готовы Stage 1–2 из «Порядок реализации»: LiteLLM-инфраструктура + каркас gateway,
который проксирует запросы в LiteLLM (**без биллинга и аутентификации**).

- `config.yaml` — список моделей и `general_settings.master_key` для LiteLLM proxy.
- `docker-compose.yml` — сервисы `litellm` и `gateway` в одном стеке, общий корневой `.env`.
- `.env` — `GEMINI_API_KEY`, `LITELLM_MASTER_KEY`, `GATEWAY_PORT` (шаблон в `.env.example`).
- `gateway/` — Express + TS (ESM, pnpm). Проксирует `POST /v1/chat/completions`
  (вкл. стрим) и `GET /v1/models`, отдаёт `GET /health`. Слой `services/litellm.ts` —
  точка расширения под биллинг (Stage 4).

БД и payment-воркера ещё нет — следующие этапы (аутентификация Stage 3, биллинг Stage 4)
из раздела «Порядок реализации» в `ARCHITECTURE.md`.

## Commands

Весь стек (LiteLLM + gateway) в одном `docker-compose.yml`, один общий `.env` в корне:

```
docker compose up -d --build   # старт всего стека (LiteLLM + gateway)
docker compose down            # стоп
docker compose logs -f gateway # или litellm
```

- gateway публикуется на `${GATEWAY_PORT:-8080}`; в контейнере общается с LiteLLM по
  имени сервиса (`http://litellm:4000`). gateway стартует после healthcheck LiteLLM.
- LiteLLM временно ещё проброшен на :4000 (для отладки и локального dev gateway).

Проверка через gateway (master-ключ клиенту НЕ нужен — его подставляет gateway):

```
curl http://localhost:8080/health
curl http://localhost:8080/v1/models
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gemini-2.5-flash","messages":[{"role":"user","content":"ping"}]}'
```

Локальный dev gateway (без docker для самого gateway). Пакетный менеджер — **pnpm**,
требует Node ≥22. Из `gateway/`:

```
docker compose up -d litellm   # нужен только LiteLLM на :4000
pnpm install
pnpm dev          # tsx watch, слушает :8080
pnpm build        # tsc -> dist/
pnpm start        # node dist/index.js
pnpm typecheck    # tsc --noEmit
```

Env — единый корневой `.env` (`GEMINI_API_KEY`, `LITELLM_MASTER_KEY`, `GATEWAY_PORT`),
шаблон в `.env.example`. config.ts gateway читает именно его.

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
