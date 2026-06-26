import { Router } from "express";
import { Readable } from "node:stream";
import { forwardChat, listModels } from "../services/litellm.js";

export const proxyRouter = Router();

proxyRouter.post("/v1/chat/completions", async (req, res, next) => {
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
