import { getNetworkConfig } from "@bachelier/shared/networks";

const network = process.env.STACKS_NETWORK ?? "devnet";
const netCfg = getNetworkConfig(network);

export const config = {
  network,
  port: Number(process.env.INDEXER_PORT ?? 4001),
  host: process.env.INDEXER_HOST ?? "0.0.0.0",
  databaseUrl: process.env.DATABASE_URL ?? "postgres://bachelier:bachelier@localhost:5432/bachelier",
  /** vault contract id whose print events we consume */
  vaultContract: process.env.VAULT_CONTRACT ?? netCfg.contracts.vault,
  /** shared secret expected in the chainhook Authorization header */
  chainhookSecret: process.env.CHAINHOOK_SECRET ?? "",
  stacksApiUrl: process.env.STACKS_API_URL ?? netCfg.stacksApiUrl,
  /** first block worth scanning during backfill */
  startBlock: Number(process.env.START_BLOCK ?? 0),
  backfillOnStart: (process.env.BACKFILL_ON_START ?? "true") === "true",
};
