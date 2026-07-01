import { db, pool } from "./index.js";
import { modelPricing } from "./schema.js";

// Каталог цен. `model` = model_name из config.yaml. Цены — базовые за 1K токенов
// (USD) от провайдера; наценка шлюза — отдельно в `markup` (cost = base × markup).
// ВАЖНО: цены сверять перед заливкой; markup — бизнес-параметр.
const MARKUP = "1.20";

const PRICING = [
  { model: "gemini-2.5-pro", provider: "gemini", inPricePer1k: "0.00125", outPricePer1k: "0.01000", contextWindow: 1048576 },
  { model: "gemini-2.5-flash", provider: "gemini", inPricePer1k: "0.00030", outPricePer1k: "0.00250", contextWindow: 1048576 },
  { model: "claude-opus-4-8", provider: "anthropic", inPricePer1k: "0.01500", outPricePer1k: "0.07500", contextWindow: 200000 },
  { model: "claude-sonnet-4-6", provider: "anthropic", inPricePer1k: "0.00300", outPricePer1k: "0.01500", contextWindow: 200000 },
  { model: "claude-haiku-4-5", provider: "anthropic", inPricePer1k: "0.00100", outPricePer1k: "0.00500", contextWindow: 200000 },
] as const;

async function seed(): Promise<void> {
  for (const p of PRICING) {
    await db
      .insert(modelPricing)
      .values({ ...p, markup: MARKUP })
      .onConflictDoUpdate({
        target: modelPricing.model,
        set: {
          provider: p.provider,
          inPricePer1k: p.inPricePer1k,
          outPricePer1k: p.outPricePer1k,
          markup: MARKUP,
          contextWindow: p.contextWindow,
          updatedAt: new Date(),
        },
      });
  }
  console.log(`[gateway] pricing seeded: ${PRICING.length} models (markup ${MARKUP})`);
}

seed()
  .then(() => pool.end())
  .catch((err) => {
    console.error("[gateway] seed failed:", err);
    process.exit(1);
  });
