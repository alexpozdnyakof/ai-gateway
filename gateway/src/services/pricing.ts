import { Decimal } from "decimal.js";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { modelPricing, type ModelPricing } from "../db/schema.js";

// In-memory кэш каталога цен. Грузится при старте (loadPricing) и обновляется
// через refresh(). Цены меняются редко — держим в памяти ради горячего пути.
let cache = new Map<string, ModelPricing>();

export async function loadPricing(): Promise<void> {
  const rows = await db.select().from(modelPricing);
  cache = new Map(rows.map((r) => [r.model, r]));
  console.log(`[gateway] pricing loaded: ${cache.size} models`);
}

// Алиас для явного обновления кэша (напр. после правок цен).
export const refresh = loadPricing;

export function getPricing(model: string | undefined): ModelPricing | undefined {
  if (!model) return undefined;
  return cache.get(model);
}

export function listPricing(): ModelPricing[] {
  return [...cache.values()];
}

/**
 * Точная стоимость запроса (без JS-float):
 *   cost = ((prompt/1000)*inPrice + (completion/1000)*outPrice) * markup
 * Возвращает строку с фикс. точностью (scale 8) для NUMERIC-колонки.
 * Бросает, если для модели нет цены — звать только после getPricing-валидации.
 */
export function computeCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
): string {
  const p = cache.get(model);
  if (!p) throw new Error(`no pricing for model ${model}`);

  const inCost = new Decimal(promptTokens).div(1000).mul(p.inPricePer1k);
  const outCost = new Decimal(completionTokens).div(1000).mul(p.outPricePer1k);
  return inCost.add(outCost).mul(p.markup).toFixed(8);
}
