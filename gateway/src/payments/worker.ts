import { Decimal } from "decimal.js";
import { eq, ne } from "drizzle-orm";
import { config, paymentsEnabled } from "../config.js";
import { db } from "../db/index.js";
import { depositAddresses, payments } from "../db/schema.js";
import { creditConfirmedPayment } from "../services/billing.js";
import { selfTestDerivation } from "./hdwallet.js";
import { fetchIncomingUsdt, getNowBlock, getTxBlock } from "./chains/tron.js";

// value → сумма в NUMERIC (USDT: 6 знаков, 1 USDT = $1).
function toAmount(value: string): string {
  return new Decimal(value).div(new Decimal(10).pow(config.USDT_DECIMALS)).toFixed(8);
}

/**
 * Один цикл поллинга: находим новые входящие USDT-переводы, регистрируем как
 * pending-платежи (идемпотентно по tx_hash), пересчитываем подтверждения и
 * зачисляем те, что достигли порога. Возвращает сводку для ручного вызова.
 */
export async function pollOnce(): Promise<{ seen: number; credited: number }> {
  let seen = 0;
  let credited = 0;

  // 1. Новые переводы на каждый депозит-адрес → pending payments.
  const addresses = await db
    .select({ userId: depositAddresses.userId, address: depositAddresses.address })
    .from(depositAddresses);

  for (const addr of addresses) {
    const transfers = await fetchIncomingUsdt(addr.address);
    for (const t of transfers) {
      seen++;
      await db
        .insert(payments)
        .values({
          userId: addr.userId,
          txHash: t.txHash,
          fromAddr: t.from,
          toAddr: t.to,
          amount: toAmount(t.value),
        })
        .onConflictDoNothing({ target: payments.txHash });
    }
  }

  // 2. Пересчёт подтверждений и зачисление незачисленных платежей.
  const pending = await db
    .select()
    .from(payments)
    .where(ne(payments.status, "credited"));

  if (pending.length > 0) {
    const now = await getNowBlock();
    for (const p of pending) {
      const block = await getTxBlock(p.txHash);
      const confirmations = block ? Math.max(0, now - block) : 0;
      const enough = confirmations >= config.CRYPTO_MIN_CONFIRMATIONS;

      await db
        .update(payments)
        .set({
          confirmations,
          blockNumber: block,
          status: enough ? "confirmed" : "pending",
          updatedAt: new Date(),
        })
        .where(eq(payments.id, p.id));

      if (enough) {
        const didCredit = await creditConfirmedPayment({
          id: p.id,
          userId: p.userId,
          amount: p.amount,
        });
        if (didCredit) credited++;
      }
    }
  }

  return { seen, credited };
}

let timer: NodeJS.Timeout | null = null;

/** Запуск фонового поллера (в процессе gateway). No-op, если крипта выключена. */
export function startPaymentWorker(): void {
  if (!paymentsEnabled) {
    console.warn(
      "[gateway] payments disabled (no TRON_XPUB/USDT_CONTRACT_ADDRESS) — worker not started",
    );
    return;
  }
  selfTestDerivation(); // fail-fast, если деривация неверна

  const intervalMs = config.CRYPTO_POLL_INTERVAL_SECONDS * 1000;
  const tick = () => {
    pollOnce().catch((err) => console.error("[gateway] payment poll failed:", err));
  };
  tick(); // сразу первый цикл
  timer = setInterval(tick, intervalMs);
  console.log(
    `[gateway] payment worker started (every ${config.CRYPTO_POLL_INTERVAL_SECONDS}s, ${config.CRYPTO_MIN_CONFIRMATIONS} confirmations)`,
  );
}

export function stopPaymentWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
