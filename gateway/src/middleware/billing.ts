import type { RequestHandler } from "express";
import { Decimal } from "decimal.js";
import { config } from "../config.js";
import { getPricing } from "../services/pricing.js";
import { getBalance } from "../services/billing.js";

/**
 * Pre-check перед проксированием в LiteLLM (после authenticate):
 *  1. стрим пока не биллим → 501;
 *  2. модель должна существовать и быть active → 400;
 *  3. баланс должен быть выше порога → 402.
 */
export const requireBalance: RequestHandler = async (req, res, next) => {
  try {
    // Стрим биллим на следующем этапе — не отдаём неучтённые токены.
    if (req.body?.stream === true) {
      res.status(501).json({
        error: {
          message: "streaming billing not yet supported",
          type: "not_implemented",
        },
      });
      return;
    }

    const pricing = getPricing(req.body?.model);
    if (!pricing || !pricing.active) {
      res.status(400).json({
        error: {
          message: `Unknown or inactive model: ${req.body?.model ?? "(none)"}`,
          type: "invalid_request_error",
        },
      });
      return;
    }

    const balance = await getBalance(req.auth!.userId);
    if (new Decimal(balance).lte(config.BILLING_MIN_BALANCE)) {
      res.status(402).json({
        error: {
          message: "Insufficient balance. Top up to continue.",
          type: "insufficient_balance",
        },
      });
      return;
    }

    next();
  } catch (err) {
    next(err);
  }
};
