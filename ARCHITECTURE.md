# Cryptophic — AI Gateway с крипто-оплатой

AI-шлюз: клиент платит криптой (предоплата балансом), потребляет AI API.
LiteLLM — внутренний слой к провайдерам, Gateway (Node/Express) — продуктовая обвязка.

## 1. Модель работы

- **Биллинг:** предоплата. Юзер пополняет баланс криптой → запросы списывают с баланса
  по факту потребления токенов → при балансе ≤ 0 запросы блокируются.
- **Оплата:** свои on-chain адреса. Уникальный депозит-адрес на каждого юзера,
  воркер слушает блокчейн, зачисляет пополнения после N подтверждений.
- **Валюта учёта:** **USDT в сети Tron (TRC-20)** — стейблкоин, баланс не плавает
  от курса; низкие комиссии, самый популярный способ перевода USDT.
- **Аутентификация:** **magic link (email) + passkey (WebAuthn)** для входа/регистрации.
  Web3-логин (SIWE-подпись кошельком) — в бэклоге на будущее.

## 2. Компоненты

```
                    публичный HTTPS
client ──────────────────────────────────► [ Gateway: Node + Express ]
  (API-ключ Cryptophic)                          │   auth, balance, billing,
                                                  │   rate-limit, usage log
                                                  ▼  внутренняя docker-сеть
                                          [ LiteLLM proxy :4000 ]  (НЕ публичный)
                                                  │  master_key
                                                  ▼
                                  Gemini 2.5 / Anthropic Claude / др. провайдеры

[ Payment worker ]  ◄──── RPC/webhook ──── blockchain (Base/Tron …)
   слушает депозиты, зачисляет баланс

[ Postgres ]  — users, api_keys, deposit_addresses, ledger, usage, pricing, payments
[ Redis ]     — rate-limit, кэш баланса, идемпотентность (опционально на старте)
```

Gateway — единственный источник правды по балансу. LiteLLM остаётся "тупым" прокси
с одним master-ключом; его spend-tracking не используем для биллинга (только как доп. лог).

## 3. Поток запроса к AI (списание)

1. Клиент шлёт `POST /v1/chat/completions` с `Authorization: Bearer <cryptophic_key>`.
2. Gateway: валидирует ключ (hash) → находит юзера → проверяет `balance > min_threshold`.
3. Если баланс ок — проксирует запрос в LiteLLM (`http://litellm:4000`) с master-ключом.
4. **Не-стрим:** из ответа LiteLLM берём `usage{prompt_tokens, completion_tokens}` →
   считаем стоимость по `model_pricing` (цена за 1K × наценка) → атомарно списываем
   с баланса (ledger-запись) → пишем `usage_record` → отдаём ответ клиенту.
5. **Стрим:** добавляем `stream_options:{include_usage:true}`, считаем usage из
   финального чанка; списываем после завершения стрима. На входе делаем "мягкую"
   проверку баланса; для защиты от ухода в минус — холд/резерв оценочной суммы.
6. Если баланс < 0 после списания — помечаем юзера, следующий запрос блокируется (402).

Стоимость: `cost = (prompt_tokens/1000)*in_price + (completion_tokens/1000)*out_price`,
цены с наценкой над провайдером (источник дохода шлюза).

## 3.1 Выбор LLM клиентом (model selection)

Клиент сам выбирает модель — это первоклассная фича, не побочный эффект прокси.

- **Каталог моделей.** `GET /v1/models` отдаёт список доступных клиенту моделей с
  метаданными: `id`, провайдер, цена in/out за 1K (с наценкой), контекстное окно,
  поддержка стрима/функций, статус (active/deprecated). Источник — таблица
  `model_pricing`, синхронизированная с `model_list` в `config.yaml` LiteLLM.
- **Выбор в запросе.** Поле `model` в теле запроса (как у OpenAI) задаёт модель.
  Gateway валидирует, что модель существует и **разрешена этому юзеру/тарифу**,
  иначе 400/403. Имена клиента = `model_name` из `config.yaml` (стабильный алиас),
  а не внутренние `litellm_params.model` — провайдера можно менять прозрачно.
- **Дефолт и алиасы.** Если `model` не указан — берём дефолтную модель. Можно завести
  алиасы/категории (`fast`, `smart`, `cheapest`) поверх конкретных моделей.
- **Pricing на модель.** У каждой модели своя цена и наценка в `model_pricing`;
  биллинг (раздел 3) считает стоимость по выбранной модели.
- **Доступность по тарифу/балансу.** Можно ограничивать набор моделей на юзера
  (allowlist) или гейтить дорогие модели по уровню — проверка в auth/billing middleware.
- **Расширяемость провайдеров.** Добавление новой модели/провайдера = запись в
  `config.yaml` `model_list` + строка в `model_pricing`; код gateway не меняется.

## 4. Поток крипто-пополнения

1. При регистрации юзеру выдаётся депозит-адрес: деривация из HD-кошелька
   (Tron BIP-44 `m/44'/195'/.../index`) по `user_id`. Приватные ключи sweeping —
   вне БД (KMS / cold storage). В БД — только адрес и derivation index.
2. Payment worker отслеживает входящие TRC-20 USDT-переводы на адреса юзеров
   через TronGrid (поллинг событий `Transfer` контракта USDT / TRC-20 events API).
3. На входящий перевод: ждём N подтверждений → идемпотентно (по `tx_hash`) создаём
   `payment` + ledger-кредит → баланс растёт. Дубль `tx_hash` игнорируется.
4. (Позже) Sweeping: перевод средств с депозит-адресов на hot/cold wallet.

## 5. Схема БД (черновик)

- **users** — id, email, created_at, status.
- **auth_credentials** — passkeys: user_id, credential_id, public_key, counter, transports.
- **magic_links** — user_id/email, token_hash, expires_at, used_at (одноразовые, TTL).
- **sessions** — id, user_id, expires_at (для дашборда после входа).
- **api_keys** — id, user_id, key_hash, prefix, name, last_used_at, revoked_at.
  (Сырой ключ показываем один раз, храним только hash.)
- **deposit_addresses** — user_id, chain(tron), address, derivation_index, unique(chain,address).
- **balances** — user_id, currency(USDC), amount (numeric), updated_at.
  Либо считаем баланс как сумму ledger (надёжнее, но дороже) + кэш.
- **ledger** — id, user_id, type(deposit|debit|adjustment|refund), amount(signed),
  ref_type, ref_id, created_at. Двойная запись / append-only — аудит и источник правды.
- **usage_records** — id, user_id, api_key_id, model, prompt_tokens, completion_tokens,
  cost, request_id, created_at, status.
- **payments** — id, user_id, chain, tx_hash(unique), from_addr, to_addr, amount,
  confirmations, status(pending|confirmed|credited), credited_at.
- **model_pricing** — model (=`model_name` из config.yaml), provider, in_price_per_1k,
  out_price_per_1k, markup, context_window, supports_stream, supports_tools,
  active, is_default. Каталог для `GET /v1/models` и расчёта стоимости.
- **model_access** (опц.) — user_id/tier → разрешённые модели (allowlist по тарифу).

Деньги — `NUMERIC`, не float. Списание баланса — в транзакции с `SELECT … FOR UPDATE`
или атомарным `UPDATE … WHERE amount >= cost` для защиты от гонок.

## 6. API Gateway (черновик эндпоинтов)

Прокси (OpenAI-совместимые, чтобы клиенты использовали обычные SDK):
- `POST /v1/chat/completions`  (стрим + не-стрим)
- `POST /v1/completions`
- `POST /v1/embeddings`
- `GET  /v1/models`

Аутентификация (для дашборда):
- `POST /auth/magic-link` — запросить magic link на email
- `GET  /auth/magic-link/verify` — подтвердить токен, создать/войти в аккаунт
- `POST /auth/passkey/register/options` · `/auth/passkey/register/verify` — регистрация passkey
- `POST /auth/passkey/login/options` · `/auth/passkey/login/verify` — вход по passkey
- (бэклог) `POST /auth/web3/nonce` · `/auth/web3/verify` — SIWE-логин

Аккаунт/биллинг:
- `POST /account/keys` — создать API-ключ; `GET /account/keys`; `DELETE /account/keys/:id`
- `GET  /account/balance` — текущий баланс + история
- `GET  /account/usage` — потребление по периодам/моделям
- `GET  /account/deposit-address` — адрес для пополнения
- `POST /webhooks/payments` — приём колбэков от провайдера (если используем)

Health/ops: `GET /health`, `GET /metrics`.

## 7. Структура кода gateway/

```
gateway/
├── package.json
├── tsconfig.json            # TypeScript рекомендуется
├── .env.example
├── Dockerfile
├── src/
│   ├── index.ts             # bootstrap express
│   ├── config.ts            # env, валидация (zod)
│   ├── db/                  # подключение, миграции (drizzle/knex/prisma)
│   ├── middleware/          # auth (api-key + session), rate-limit, error handler
│   ├── routes/              # proxy.ts, auth.ts, account.ts, webhooks.ts, health.ts
│   ├── auth/                # magic-link.ts, passkey.ts (WebAuthn), sessions.ts
│   ├── services/
│   │   ├── litellm.ts       # клиент к LiteLLM
│   │   ├── billing.ts       # расчёт стоимости, списание (ledger)
│   │   ├── pricing.ts       # таблица цен/наценка
│   │   └── keys.ts          # генерация/проверка API-ключей
│   ├── payments/
│   │   ├── worker.ts        # отслеживание блокчейна (TronGrid)
│   │   ├── hdwallet.ts      # деривация Tron-адресов (BIP-44 195')
│   │   └── chains/          # tron.ts адаптер (USDT TRC-20)
│   └── domain/              # типы, схемы
└── test/
```

## 8. Изменения инфраструктуры (вне первого шага, но запланировать)

- **Убрать `4000` из публичного проброса** LiteLLM; общение gateway↔litellm
  по имени сервиса во внутренней docker-сети.
- **`.gitignore`** + вынести секреты; **отозвать и перевыпустить** текущий
  `GEMINI_API_KEY` (он лежит в `.env` в открытом виде).
- Добавить сервисы `gateway`, `postgres`, (`redis`) в `docker-compose.yml`.
- LiteLLM можно подключить к Postgres для своего spend-лога (опционально).

## 9. Порядок реализации (этапы)

1. **Инфра:** docker-сеть, postgres, .gitignore, скрытие LiteLLM. Ротация ключа.
2. **Скелет gateway:** Express + TS, конфиг, health, прокси `chat/completions`
   с master-ключом (пока без биллинга) — сквозной путь client→gateway→litellm→Gemini.
3. **Аутентификация:** API-ключи (создание/хранение hash/проверка middleware).
4. **Биллинг:** pricing, расчёт cost из usage, ledger-списание, блок при нуле, стрим.
5. **Крипто-пополнение:** HD-кошелёк, депозит-адреса, payment worker, зачисление.
6. **Аккаунт-API и наблюдаемость:** баланс/usage, метрики, логи, алерты.

## Решения (зафиксированы)

- Биллинг: **предоплата балансом**.
- Оплата: **свои on-chain адреса, USDT TRC-20 (Tron)**.
- Gateway: **TypeScript**.
- Аутентификация: **magic link + passkey (WebAuthn)**; web3-логин (SIWE) — в бэклоге.

## Открытые вопросы

- TronGrid (managed) или свой Tron-узел для отслеживания депозитов?
- Минимум подтверждений Tron для зачисления; политика sweeping средств в hot/cold wallet.
- Email-провайдер для magic link (Resend/Postmark/SES)?
- Дашборд: отдельный фронт (SPA) или server-rendered внутри gateway?
- ORM/миграции: Drizzle vs Prisma vs Knex.
