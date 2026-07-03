import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { depositAddresses } from "../db/schema.js";
import { deriveDepositAddress } from "./hdwallet.js";

/**
 * Вернуть депозит-адрес юзера, создав при отсутствии. Индекс деривации выдаётся
 * атомарно из sequence, адрес — из watch-only xpub. Идемпотентно: unique(userId)
 * ловит гонку (в этом случае возвращаем уже существующий ряд).
 */
export async function getOrCreateDepositAddress(
  userId: string,
): Promise<{ chain: string; address: string }> {
  const existing = await db
    .select({ chain: depositAddresses.chain, address: depositAddresses.address })
    .from(depositAddresses)
    .where(eq(depositAddresses.userId, userId))
    .limit(1);
  if (existing[0]) return existing[0];

  const seqResult = await db.execute(
    sql`SELECT nextval('deposit_derivation_seq')::int AS index`,
  );
  const index = (seqResult.rows[0] as { index: number }).index;
  const address = deriveDepositAddress(index);

  try {
    const [row] = await db
      .insert(depositAddresses)
      .values({ userId, address, derivationIndex: index })
      .returning({ chain: depositAddresses.chain, address: depositAddresses.address });
    return row!;
  } catch (err) {
    // Гонка: параллельный запрос уже создал адрес — вернём его.
    if ((err as { code?: string })?.code === "23505") {
      const [row] = await db
        .select({ chain: depositAddresses.chain, address: depositAddresses.address })
        .from(depositAddresses)
        .where(eq(depositAddresses.userId, userId))
        .limit(1);
      if (row) return row;
    }
    throw err;
  }
}
