import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  numeric,
  boolean,
  index,
} from "drizzle-orm/pg-core";

// Пользователи. На Stage 3 — минимум; auth дашборда (magic-link/passkey) позже.
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// API-ключи. Храним только SHA-256-хеш (сырой ключ показываем один раз).
// key_hash unique + индекс — прямой O(log n) lookup при аутентификации.
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    keyHash: text("key_hash").notNull().unique(),
    prefix: text("prefix").notNull(),
    name: text("name"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("api_keys_key_hash_idx").on(t.keyHash)],
);

// ── Stage 4: биллинг ────────────────────────────────────────────────────────
// Деньги — NUMERIC, не float (precision 20 / scale 8). Баланс храним как одно
// число в `balances` (быстрый горячий путь), а `ledger` — append-only аудит.

// Баланс юзера. Один ряд на юзера (user_id — PK). Списание атомарно:
// UPDATE balances SET amount = amount - cost WHERE user_id = ?.
export const balances = pgTable("balances", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  amount: numeric("amount", { precision: 20, scale: 8 }).notNull().default("0"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Журнал движений денег (append-only) — источник правды для аудита.
// amount знаковая: + пополнение, − списание.
export const ledger = pgTable(
  "ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // deposit | debit | adjustment | refund
    amount: numeric("amount", { precision: 20, scale: 8 }).notNull(),
    refType: text("ref_type"), // напр. "usage_record" | "payment"
    refId: uuid("ref_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("ledger_user_id_idx").on(t.userId)],
);

// Записи об использовании — что, сколько токенов и за сколько списали.
export const usageRecords = pgTable(
  "usage_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    apiKeyId: uuid("api_key_id").references(() => apiKeys.id, {
      onDelete: "set null",
    }),
    model: text("model").notNull(),
    promptTokens: integer("prompt_tokens").notNull(),
    completionTokens: integer("completion_tokens").notNull(),
    cost: numeric("cost", { precision: 20, scale: 8 }).notNull(),
    requestId: text("request_id"),
    status: text("status").notNull().default("ok"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("usage_records_user_id_idx").on(t.userId),
    index("usage_records_created_at_idx").on(t.createdAt),
  ],
);

// Каталог цен. `model` = model_name из config.yaml. Цена за 1K токенов;
// наценка шлюза — отдельной колонкой `markup` (cost = base × markup).
export const modelPricing = pgTable("model_pricing", {
  model: text("model").primaryKey(),
  provider: text("provider").notNull(),
  inPricePer1k: numeric("in_price_per_1k", {
    precision: 20,
    scale: 8,
  }).notNull(),
  outPricePer1k: numeric("out_price_per_1k", {
    precision: 20,
    scale: 8,
  }).notNull(),
  markup: numeric("markup", { precision: 10, scale: 4 }).notNull().default("1"),
  contextWindow: integer("context_window"),
  supportsStream: boolean("supports_stream").notNull().default(true),
  supportsTools: boolean("supports_tools").notNull().default(true),
  active: boolean("active").notNull().default(true),
  isDefault: boolean("is_default").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type User = typeof users.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type Balance = typeof balances.$inferSelect;
export type LedgerEntry = typeof ledger.$inferSelect;
export type UsageRecord = typeof usageRecords.$inferSelect;
export type ModelPricing = typeof modelPricing.$inferSelect;
