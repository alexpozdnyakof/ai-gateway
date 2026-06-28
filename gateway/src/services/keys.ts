import { randomBytes, createHash } from "node:crypto";
import { db } from "../db/index.js";
import { apiKeys } from "../db/schema.js";

const PREFIX = "cphc_";

/** SHA-256 hex от сырого ключа — то, что хранится и по чему ищем. */
export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Генерирует новый API-ключ: 32 случайных байта (256 бит энтропии).
 * Возвращает сырой ключ (показать один раз), его хеш и публичный prefix.
 */
export function generateApiKey(): {
  raw: string;
  hash: string;
  prefix: string;
} {
  const raw = PREFIX + randomBytes(32).toString("base64url");
  return {
    raw,
    hash: hashApiKey(raw),
    // первые символы — для отображения в списке ключей (cphc_ + кусок)
    prefix: raw.slice(0, 12),
  };
}

/**
 * Создаёт ключ для юзера. Сырой ключ возвращается только здесь.
 */
export async function createApiKeyForUser(
  userId: string,
  name?: string,
): Promise<{ id: string; prefix: string; raw: string }> {
  const { raw, hash, prefix } = generateApiKey();
  const [row] = await db
    .insert(apiKeys)
    .values({ userId, keyHash: hash, prefix, name: name ?? null })
    .returning({ id: apiKeys.id, prefix: apiKeys.prefix });

  return { id: row!.id, prefix: row!.prefix, raw };
}
