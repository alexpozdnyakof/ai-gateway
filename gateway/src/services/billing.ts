import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { balances, ledger, usageRecords } from "../db/schema.js";
import { computeCost } from "./pricing.js";

// Тип транзакционного объекта drizzle (callback-параметр db.transaction).
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Гарантируем ряд баланса для юзера (лениво, 0 если нет). Идемпотентно.
async function ensureBalance(tx: Tx, userId: string): Promise<void> {
  await tx
    .insert(balances)
    .values({ userId })
    .onConflictDoNothing({ target: balances.userId });
}

// Завести ряд баланса для юзера (0). Идемпотентно — для создания юзера.
export async function ensureBalanceRow(userId: string): Promise<void> {
  await db
    .insert(balances)
    .values({ userId })
    .onConflictDoNothing({ target: balances.userId });
}

// Текущий баланс юзера в виде строки NUMERIC ("0" если ряда ещё нет).
export async function getBalance(userId: string): Promise<string> {
  const [row] = await db
    .select({ amount: balances.amount })
    .from(balances)
    .where(eq(balances.userId, userId))
    .limit(1);
  return row?.amount ?? "0";
}

type ChargeInput = {
  userId: string;
  apiKeyId: string | null;
  model: string;
  promptTokens: number;
  completionTokens: number;
  requestId?: string | null;
};

/**
 * Списание по факту: считаем cost, атомарно вычитаем из баланса, пишем
 * usage_record и ledger-строку (debit) — всё в одной транзакции.
 * Запрос уже обслужен, поэтому допускаем уход в небольшой минус (следующий
 * запрос заблокируется на pre-check). Возвращает посчитанный cost.
 */
export async function chargeUsage(input: ChargeInput): Promise<string> {
  const cost = computeCost(
    input.model,
    input.promptTokens,
    input.completionTokens,
  );

  await db.transaction(async (tx) => {
    await ensureBalance(tx, input.userId);

    await tx
      .update(balances)
      .set({
        amount: sql`${balances.amount} - ${cost}`,
        updatedAt: new Date(),
      })
      .where(eq(balances.userId, input.userId));

    const [usage] = await tx
      .insert(usageRecords)
      .values({
        userId: input.userId,
        apiKeyId: input.apiKeyId,
        model: input.model,
        promptTokens: input.promptTokens,
        completionTokens: input.completionTokens,
        cost,
        requestId: input.requestId ?? null,
      })
      .returning({ id: usageRecords.id });

    await tx.insert(ledger).values({
      userId: input.userId,
      type: "debit",
      amount: `-${cost}`,
      refType: "usage_record",
      refId: usage!.id,
    });
  });

  return cost;
}

type CreditType = "deposit" | "adjustment" | "refund";

/**
 * Пополнение/корректировка баланса (ручное — до крипто-пополнения Stage 5).
 * amount — положительная строка NUMERIC. Атомарно: баланс + ledger-кредит.
 */
export async function credit(
  userId: string,
  amount: string,
  type: CreditType = "deposit",
): Promise<string> {
  let newAmount = "0";
  await db.transaction(async (tx) => {
    await ensureBalance(tx, userId);

    const [row] = await tx
      .update(balances)
      .set({
        amount: sql`${balances.amount} + ${amount}`,
        updatedAt: new Date(),
      })
      .where(eq(balances.userId, userId))
      .returning({ amount: balances.amount });
    newAmount = row!.amount;

    await tx.insert(ledger).values({ userId, type, amount });
  });

  return newAmount;
}
