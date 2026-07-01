import { Decimal } from "decimal.js";
import { config } from "../config.js";
import { listPricing } from "./pricing.js";

const authHeader = `Bearer ${config.LITELLM_MASTER_KEY}`;

export function forwardChat(body: unknown): Promise<Response> {
  return fetch(`${config.LITELLM_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

// Эффективная цена за 1K с учётом наценки (строка, scale 8).
function withMarkup(pricePer1k: string, markup: string): string {
  return new Decimal(pricePer1k).mul(markup).toFixed(8);
}

/**
 * Каталог моделей. Источник правды — наш `model_pricing` (а не LiteLLM):
 * отдаём только активные модели с метаданными и ценами с наценкой.
 * Формат OpenAI-совместимый ({object:"list", data:[...]}) + наши поля.
 */
export function listModels(): { object: "list"; data: unknown[] } {
  const data = listPricing()
    .filter((m) => m.active)
    .map((m) => ({
      id: m.model,
      object: "model",
      owned_by: m.provider,
      context_window: m.contextWindow,
      in_price_per_1k: withMarkup(m.inPricePer1k, m.markup),
      out_price_per_1k: withMarkup(m.outPricePer1k, m.markup),
      supports_stream: m.supportsStream,
      supports_tools: m.supportsTools,
    }));
  return { object: "list", data };
}
