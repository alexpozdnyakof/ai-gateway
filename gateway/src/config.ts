import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { z } from "zod";

const location = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(location, "../../.env") });

const envSchema = z.object({
  LITELLM_URL: z.string().url().default("http://localhost:4000"),
  LITELLM_MASTER_KEY: z.string().min(1, "LITELLM_MASTER_KEY is required"),
  GATEWAY_PORT: z.coerce.number().int().positive().default(8080),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
  console.error(`Invalid environment configuration:\n${issues}`);
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
