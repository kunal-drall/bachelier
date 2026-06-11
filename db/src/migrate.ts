import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import url from "node:url";
import { createDb } from "./index.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));

export async function runMigrations(databaseUrl = process.env.DATABASE_URL): Promise<void> {
  const handle = createDb(databaseUrl);
  try {
    await migrate(handle.db, { migrationsFolder: path.join(here, "../migrations") });
  } finally {
    await handle.close();
  }
}

if (process.argv[1] && url.fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runMigrations()
    .then(() => {
      console.log("migrations applied");
      process.exit(0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
