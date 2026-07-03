import { Router } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { adminAuth } from "../middleware/admin.js";
import { createApiKeyForUser } from "../services/keys.js";
import { credit, ensureBalanceRow } from "../services/billing.js";
import { paymentsEnabled } from "../config.js";
import { getOrCreateDepositAddress } from "../payments/deposit.js";
import { pollOnce } from "../payments/worker.js";

export const adminRouter = Router();

// Только /admin/* — под admin-токеном (путь обязателен, иначе guard ловит все запросы).
adminRouter.use("/admin", adminAuth);

const createUserSchema = z.object({ email: z.string().email() });
const createKeySchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).optional(),
});
// amount — положительная NUMERIC-строка ("10.00"), без float.
const creditSchema = z.object({
  email: z.string().email(),
  amount: z.string().regex(/^\d+(\.\d+)?$/, "amount must be a positive number"),
});

// Код ошибки уникального ограничения Postgres.
const PG_UNIQUE_VIOLATION = "23505";

// POST /admin/users { email } — создать юзера.
adminRouter.post("/admin/users", async (req, res, next) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: "email is required", type: "invalid_request_error" } });
    return;
  }

  try {
    const [row] = await db
      .insert(users)
      .values({ email: parsed.data.email })
      .returning({ id: users.id, email: users.email });
    // Сразу заводим нулевой баланс.
    await ensureBalanceRow(row!.id);
    // Если крипта включена — сразу выдаём депозит-адрес (иначе заведётся лениво).
    if (paymentsEnabled) await getOrCreateDepositAddress(row!.id);
    res.status(201).json(row);
  } catch (err) {
    if ((err as { code?: string })?.code === PG_UNIQUE_VIOLATION) {
      res.status(409).json({ error: { message: "User already exists", type: "conflict" } });
      return;
    }
    next(err);
  }
});

// POST /admin/keys { email, name? } — выдать ключ юзеру (raw показываем один раз).
adminRouter.post("/admin/keys", async (req, res, next) => {
  const parsed = createKeySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: "email is required", type: "invalid_request_error" } });
    return;
  }

  try {
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, parsed.data.email))
      .limit(1);

    if (!user) {
      res.status(404).json({ error: { message: "User not found", type: "not_found" } });
      return;
    }

    const key = await createApiKeyForUser(user.id, parsed.data.name);
    res.status(201).json({ id: key.id, prefix: key.prefix, key: key.raw });
  } catch (err) {
    next(err);
  }
});

// POST /admin/credit { email, amount } — пополнить баланс юзеру (до крипты).
adminRouter.post("/admin/credit", async (req, res, next) => {
  const parsed = creditSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.issues[0]?.message ?? "invalid request", type: "invalid_request_error" } });
    return;
  }

  try {
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, parsed.data.email))
      .limit(1);

    if (!user) {
      res.status(404).json({ error: { message: "User not found", type: "not_found" } });
      return;
    }

    const amount = await credit(user.id, parsed.data.amount, "deposit");
    res.status(200).json({ amount });
  } catch (err) {
    next(err);
  }
});

// POST /admin/payments/poll — ручной прогон поллинга депозитов (для E2E).
adminRouter.post("/admin/payments/poll", async (_req, res, next) => {
  if (!paymentsEnabled) {
    res.status(503).json({ error: { message: "payments not configured", type: "unavailable" } });
    return;
  }
  try {
    const summary = await pollOnce();
    res.status(200).json(summary);
  } catch (err) {
    next(err);
  }
});
