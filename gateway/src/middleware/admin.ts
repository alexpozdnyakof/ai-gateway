import type { RequestHandler } from "express";
import { timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

/** Constant-time сравнение строк (защита от timing-атак). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Защита admin-эндпоинтов: токен из заголовка `X-Admin-Token`
 * (или `Authorization: Bearer`) сверяется с config.ADMIN_TOKEN.
 */
export const adminAuth: RequestHandler = (req, res, next) => {
  const fromHeader = req.header("x-admin-token");
  const bearer = req.header("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const token = fromHeader ?? bearer ?? "";

  if (!safeEqual(token, config.ADMIN_TOKEN)) {
    res.status(401).json({
      error: { message: "Invalid admin token", type: "authentication_error" },
    });
    return;
  }

  next();
};
