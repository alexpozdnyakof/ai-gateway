import { randomBytes, createHash } from "node:crypto";
import { db } from "../db/index.js";
import { apiKeys } from "../db/schema.js";

const PREFIX = "cphc_";

export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

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
