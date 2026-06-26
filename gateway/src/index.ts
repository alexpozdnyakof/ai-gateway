import express from "express";
import { config } from "./config.js";
import { healthRouter } from "./routes/health.js";
import { proxyRouter } from "./routes/proxy.js";
import { errorHandler } from "./middleware/error.js";

const app = express();

app.use(express.json({ limit: "1mb" }));

app.use(healthRouter);
app.use(proxyRouter);

app.use(errorHandler);

app.listen(config.GATEWAY_PORT, () => {
  console.log(
    `[gateway] listening on :${config.GATEWAY_PORT} → LiteLLM ${config.LITELLM_URL}`,
  );
});
