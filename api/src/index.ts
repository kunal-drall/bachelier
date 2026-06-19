import { createDb } from "@bachelier/db";
import { config } from "./config.js";
import { createChainReader } from "./chain.js";
import { buildApi } from "./routes.js";

async function main() {
  const { db } = createDb(config.databaseUrl);
  const chain = createChainReader(config.netCfg, config.stacksApiUrl);
  const app = await buildApi({
    db,
    chain,
    stacksApiUrl: config.stacksApiUrl,
    corsOrigin: config.corsOrigin,
    riskFreeRate: config.riskFreeRate,
    roundLenSecs: config.roundLenSecs,
    defaultIv: config.defaultIv,
    defaultOtmBps: config.defaultOtmBps,
  });
  await app.listen({ port: config.port, host: config.host });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
