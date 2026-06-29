import type { RequestHandler } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { apiKeys, users } from "../db/schema.js";
import { hashApiKey } from "../services/keys.js";

function unauthorized(message: string) {
  return {
    error: { message, type: "authentication_error" },
  };
}

export const authenticate: RequestHandler = async (req, res, next) => {
  try {
    const header = req.header("authorization") ?? "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      res
        .status(401)
        .json(unauthorized("Missing or malformed Authorization header"));
      return;
    }

    const keyHash = hashApiKey(match[1]!);
    const [row] = await db
      .select({
        apiKeyId: apiKeys.id,
        userId: users.id,
        email: users.email,
      })
      .from(apiKeys)
      .innerJoin(users, eq(apiKeys.userId, users.id))
      .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)))
      .limit(1);

    if (!row) {
      res.status(401).json(unauthorized("Invalid API key"));
      return;
    }

    req.auth = { userId: row.userId, apiKeyId: row.apiKeyId, email: row.email };

    // Отметка использования — fire-and-forget, не блокируем запрос.
    db.update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, row.apiKeyId))
      .catch((err) =>
        console.error("[gateway] last_used_at update failed:", err),
      );

    next();
  } catch (err) {
    next(err);
  }
};
