import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { db, pool } from "./index.js";

const here = dirname(fileURLToPath(import.meta.url));
// dev: src/db -> ../../drizzle = gateway/drizzle; prod: dist/db -> ../../drizzle (COPY в образ).
const migrationsFolder = resolve(here, "../../drizzle");

/**
 * Идемпотентно накатывает миграции. Вызывается на старте приложения
 * (index.ts) и доступна как отдельная команда `pnpm db:migrate`.
 */
export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder });
  console.log("[gateway] migrations applied");
}

// Запуск напрямую: `tsx src/db/migrate.ts`.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[gateway] migration failed:", err);
      process.exit(1);
    });
}
