import { Router } from "express";
import { Readable } from "node:stream";
import { forwardChat, listModels } from "../services/litellm.js";
import { authenticate } from "../middleware/auth.js";
import { requireBalance } from "../middleware/billing.js";
import { chargeUsage } from "../services/billing.js";

export const proxyRouter = Router();

// Только /v1/* требуют валидный API-ключ (путь обязателен).
proxyRouter.use("/v1", authenticate);

proxyRouter.post("/v1/chat/completions", requireBalance, async (req, res, next) => {
  try {
    const upstream = await forwardChat(req.body);
    const isStream = req.body?.stream === true;

    if (isStream && upstream.body) {
      // Пробрасываем статус и тип контента, затем стримим тело как есть.
      res.status(upstream.status);
      res.setHeader(
        "Content-Type",
        upstream.headers.get("content-type") ?? "text/event-stream",
      );
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0])
        .on("error", next)
        .pipe(res);
      return;
    }

    // Обычный ответ: отдаём тело и статус как есть.
    const data = await upstream.json();

    // Списание по факту: usage из ответа LiteLLM. Ошибку учёта логируем, но
    // ответ всё равно отдаём — не рушим уже обслуженный запрос.
    const usage = (data as { usage?: { prompt_tokens?: number; completion_tokens?: number } })?.usage;
    if (upstream.ok && usage) {
      try {
        await chargeUsage({
          userId: req.auth!.userId,
          apiKeyId: req.auth!.apiKeyId,
          model: req.body.model,
          promptTokens: usage.prompt_tokens ?? 0,
          completionTokens: usage.completion_tokens ?? 0,
          requestId: (data as { id?: string })?.id ?? null,
        });
      } catch (err) {
        console.error("[gateway] chargeUsage failed:", err);
      }
    }

    res.status(upstream.status).json(data);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /v1/models — список доступных моделей из LiteLLM.
 */
proxyRouter.get("/v1/models", async (_req, res, next) => {
  try {
    res.json(await listModels());
  } catch (err) {
    next(err);
  }
});
