import type { ErrorRequestHandler } from "express";

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  // Ошибки fetch (LiteLLM недоступен и т.п.) — это проблема апстрима.
  const isUpstream = err instanceof TypeError || err?.cause !== undefined;
  const status = isUpstream ? 502 : 500;
  const message = err instanceof Error ? err.message : "Internal gateway error";

  console.error("[gateway] error:", err);

  // Если стриминг уже начался — заголовки отправлены, ничего не сделать.
  if (res.headersSent) {
    res.end();
    return;
  }

  res.status(status).json({
    error: {
      message,
      type: isUpstream ? "upstream_error" : "gateway_error",
    },
  });
};
