import { createDb } from "@bachelier/db";
import { runMigrations } from "@bachelier/db/migrate";
import { config } from "./config.js";
import { buildServer } from "./server.js";
import { backfill } from "./backfill.js";

async function main() {
  await runMigrations(config.databaseUrl);
  const { db } = createDb(config.databaseUrl);

  if (config.backfillOnStart) {
    try {
      await backfill(db, config.stacksApiUrl, config.vaultContract, config.startBlock);
    } catch (e) {
      console.warn("backfill failed (continuing with live webhook):", (e as Error).message);
    }
  }

  const app = buildServer({
    db,
    vaultContract: config.vaultContract,
    chainhookSecret: config.chainhookSecret,
  });
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`indexer listening on :${config.port}, watching ${config.vaultContract}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
