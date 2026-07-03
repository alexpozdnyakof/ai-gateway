import { config } from "../../config.js";

// Плоский REST-клиент к TronGrid. Сеть/контракт/ключ — из env (Nile по умолчанию).

function headers(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (config.TRONGRID_API_KEY) h["TRON-PRO-API-KEY"] = config.TRONGRID_API_KEY;
  return h;
}

export type Trc20Transfer = {
  txHash: string;
  from: string;
  to: string;
  value: string; // целое в минимальных единицах (6 знаков у USDT)
  blockTimestamp: number;
};

type Trc20Row = {
  transaction_id: string;
  from: string;
  to: string;
  value: string;
  block_timestamp: number;
  token_info?: { address?: string };
};

/** Входящие USDT-переводы на адрес (only_to), отфильтрованные по контракту. */
export async function fetchIncomingUsdt(
  address: string,
  minTimestamp?: number,
): Promise<Trc20Transfer[]> {
  const params = new URLSearchParams({
    only_to: "true",
    limit: "200",
    contract_address: config.USDT_CONTRACT_ADDRESS!,
  });
  if (minTimestamp) params.set("min_timestamp", String(minTimestamp));

  const url = `${config.TRONGRID_URL}/v1/accounts/${address}/transactions/trc20?${params}`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    throw new Error(`TronGrid trc20 ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as { data?: Trc20Row[] };
  return (body.data ?? []).map((r) => ({
    txHash: r.transaction_id,
    from: r.from,
    to: r.to,
    value: r.value,
    blockTimestamp: r.block_timestamp,
  }));
}

/** Текущая высота блока — для подсчёта подтверждений. */
export async function getNowBlock(): Promise<number> {
  const res = await fetch(`${config.TRONGRID_URL}/wallet/getnowblock`, {
    method: "POST",
    headers: headers(),
  });
  if (!res.ok) throw new Error(`TronGrid getnowblock ${res.status}`);
  const body = (await res.json()) as {
    block_header?: { raw_data?: { number?: number } };
  };
  return body.block_header?.raw_data?.number ?? 0;
}

/** Номер блока транзакции (0/undefined — ещё не в блоке). */
export async function getTxBlock(txHash: string): Promise<number | null> {
  const res = await fetch(
    `${config.TRONGRID_URL}/wallet/gettransactioninfobyid`,
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ value: txHash }),
    },
  );
  if (!res.ok) throw new Error(`TronGrid gettransactioninfobyid ${res.status}`);
  const body = (await res.json()) as { blockNumber?: number };
  return body.blockNumber ?? null;
}
