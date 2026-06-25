# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Cryptophic — AI gateway с оплатой в крипте. Клиент шлёт OpenAI-совместимые запросы →
**Gateway** (Node + Express, TypeScript) проксирует их в **LiteLLM** → провайдеры
(сейчас Gemini 2.5 pro/flash). Оплата — предоплата балансом, пополнение криптой
(USDT TRC-20, свои депозит-адреса).

Полный архитектурный план и принятые решения — в `ARCHITECTURE.md`. Сверяйся с ним
при реализации; это живой источник правды по дизайну.

## Текущее состояние

Ранняя стадия. Реально существует только LiteLLM-инфраструктура:
- `config.yaml` — список моделей и `general_settings.master_key` для LiteLLM proxy.
- `docker-compose.yml` — сервис `litellm` (порт 4000), читает `config.yaml` и `.env`.
- `.env` — `GEMINI_API_KEY`, `LITELLM_MASTER_KEY` (шаблон в `.env.example`).
- `gateway/src/` — каркас под Express-приложение, **пока пустой**.

Приложения gateway, БД и payment-воркера ещё нет — они создаются по этапам из
раздела «Порядок реализации» в `ARCHITECTURE.md`.

## Commands

LiteLLM proxy (поднимает прокси к провайдерам на :4000):
```
docker compose up        # старт; добавь -d для фона
docker compose down      # стоп
docker compose logs -f litellm
```

Проверка модели через прокси (нужен запущенный LiteLLM и `LITELLM_MASTER_KEY`):
```
curl http://localhost:4000/v1/chat/completions \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gemini-2.5-flash","messages":[{"role":"user","content":"ping"}]}'
```

Gateway-команды (build/lint/test/dev) появятся вместе с `gateway/package.json` —
добавь их сюда, как только проект инициализирован.

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
