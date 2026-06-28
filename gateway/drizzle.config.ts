import { defineConfig } from "drizzle-kit";
import "dotenv/config";
import { resolve } from "node:path";
import dotenv from "dotenv";

// Корневой единый .env (drizzle-kit запускается из gateway/).
dotenv.config({ path: resolve(process.cwd(), "../.env") });

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
