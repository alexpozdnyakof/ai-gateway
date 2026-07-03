import express from "express";
import { config } from "./config.js";
import { runMigrations } from "./db/migrate.js";
import { loadPricing } from "./services/pricing.js";
import { startPaymentWorker } from "./payments/worker.js";
import { healthRouter } from "./routes/health.js";
import { adminRouter } from "./routes/admin.js";
import { accountRouter } from "./routes/account.js";
import { proxyRouter } from "./routes/proxy.js";
import { errorHandler } from "./middleware/error.js";

const app = express();

app.use(express.json({ limit: "1mb" }));

app.use(healthRouter); // public
app.use(adminRouter); // adminAuth
app.use(accountRouter); // authenticate
app.use(proxyRouter); // authenticate

// Error handler регистрируется последним.
app.use(errorHandler);

async function bootstrap() {
  // Накатываем схему перед стартом (idempotent).
  await runMigrations();

  // Загружаем каталог цен в память (горячий путь биллинга).
  await loadPricing();

  app.listen(config.GATEWAY_PORT, () => {
    console.log(
      `[gateway] listening on :${config.GATEWAY_PORT} → LiteLLM ${config.LITELLM_URL}`,
    );
  });

  // Фоновый поллер крипто-депозитов (no-op, если крипта не сконфигурена).
  startPaymentWorker();
}

bootstrap().catch((err) => {
  console.error("[gateway] failed to start:", err);
  process.exit(1);
});
