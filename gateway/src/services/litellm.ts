import { config } from "../config.js";

const authHeader = `Bearer ${config.LITELLM_MASTER_KEY}`;

export function forwardChat(body: unknown): Promise<Response> {
  // TODO(billing): после ответа читать usage (для стрима — stream_options.include_usage)
  // и списывать баланс через services/billing.ts.
  return fetch(`${config.LITELLM_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

export async function listModels(): Promise<unknown> {
  const upstream = await fetch(`${config.LITELLM_URL}/v1/models`, {
    headers: { Authorization: authHeader },
  });
  return upstream.json();
}
