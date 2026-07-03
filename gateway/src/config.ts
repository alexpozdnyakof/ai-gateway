import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { z } from "zod";

const location = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(location, "../../.env") });

const envSchema = z.object({
  LITELLM_URL: z.string().url().default("http://localhost:4000"),
  LITELLM_MASTER_KEY: z.string().min(1, "LITELLM_MASTER_KEY is required"),
  GATEWAY_PORT: z.coerce.number().int().positive().default(8080),
  // Postgres. WHATWG URL принимает схему postgres://, поэтому .url() подходит.
  DATABASE_URL: z.string().url(),
  // Секрет для admin-эндпоинтов (bootstrap юзеров/ключей).
  ADMIN_TOKEN: z.string().min(1, "ADMIN_TOKEN is required"),
  // Минимальный баланс для пропуска запроса (NUMERIC-строка). Ниже — 402.
  BILLING_MIN_BALANCE: z.string().default("0"),

  // ── Крипто-пополнение (Stage 5). Всё опционально: без TRON_XPUB worker не стартует.
  // Account-level xpub (m/44'/195'/0') — watch-only, приватного ключа тут нет.
  TRON_XPUB: z.string().optional(),
  TRONGRID_URL: z.string().url().default("https://nile.trongrid.io"),
  TRONGRID_API_KEY: z.string().optional(),
  // TRC-20 контракт USDT (Nile сейчас, mainnet позже — только через env).
  USDT_CONTRACT_ADDRESS: z.string().optional(),
  USDT_DECIMALS: z.coerce.number().int().positive().default(6),
  // Финализация Tron ~19 SR-блоков.
  CRYPTO_MIN_CONFIRMATIONS: z.coerce.number().int().positive().default(19),
  CRYPTO_POLL_INTERVAL_SECONDS: z.coerce.number().int().positive().default(30),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
  console.error(`Invalid environment configuration:\n${issues}`);
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;

// Крипта включена, только если задан xpub и адрес USDT-контракта.
export const paymentsEnabled = Boolean(
  config.TRON_XPUB && config.USDT_CONTRACT_ADDRESS,
);
