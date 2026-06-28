import { Router } from "express";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { apiKeys } from "../db/schema.js";
import { authenticate } from "../middleware/auth.js";
import { createApiKeyForUser } from "../services/keys.js";

export const accountRouter = Router();

// Только /account/* — под аутентификацией по API-ключу (путь обязателен).
accountRouter.use("/account", authenticate);

const createKeySchema = z.object({ name: z.string().min(1).optional() });

// GET /account/keys — ключи текущего юзера (без hash/raw).
accountRouter.get("/account/keys", async (req, res, next) => {
  try {
    const rows = await db
      .select({
        id: apiKeys.id,
        prefix: apiKeys.prefix,
        name: apiKeys.name,
        createdAt: apiKeys.createdAt,
        lastUsedAt: apiKeys.lastUsedAt,
        revokedAt: apiKeys.revokedAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.userId, req.auth!.userId));
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

// POST /account/keys { name? } — новый ключ для себя (raw один раз).
accountRouter.post("/account/keys", async (req, res, next) => {
  const parsed = createKeySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: "invalid name", type: "invalid_request_error" } });
    return;
  }
  try {
    const key = await createApiKeyForUser(req.auth!.userId, parsed.data.name);
    res.status(201).json({ id: key.id, prefix: key.prefix, key: key.raw });
  } catch (err) {
    next(err);
  }
});

// DELETE /account/keys/:id — отозвать свой ключ.
accountRouter.delete("/account/keys/:id", async (req, res, next) => {
  try {
    const [row] = await db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(apiKeys.id, req.params.id),
          eq(apiKeys.userId, req.auth!.userId),
          isNull(apiKeys.revokedAt),
        ),
      )
      .returning({ id: apiKeys.id });

    if (!row) {
      res.status(404).json({ error: { message: "Key not found", type: "not_found" } });
      return;
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
