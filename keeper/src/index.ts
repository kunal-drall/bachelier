import Fastify from "fastify";
import cron from "node-cron";
import { config, requireKey } from "./config.js";
import { createKeeperChain } from "./chain.js";
import { createKeeperLoop } from "./keeper.js";

async function main() {
  const chain = createKeeperChain(config.netCfg, config.stacksApiUrl, requireKey(), config.fee);
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

  const loop = createKeeperLoop({
    chain,
    otmBps: config.otmBps,
    iv1e8: config.iv1e8,
    priceRelay: config.priceRelay,
    priceSourceUrl: config.priceSourceUrl,
    maxRetries: config.maxRetries,
    log: (msg, extra) => app.log.info(extra ?? {}, msg),
  });

  app.get("/health", async () => ({
    ok: loop.status.consecutiveFailures < 5,
    keeper: chain.address,
    ...loop.status,
  }));

  // weekly schedule: open a round every Friday 08:00 UTC
  cron.schedule(config.roundCron, () => loop.requestStart(), { timezone: "UTC" });
  if (config.startOnBoot) loop.requestStart();

  await app.listen({ port: config.port, host: config.host });
  app.log.info(`keeper ${chain.address} watching ${config.netCfg.contracts.vault} (round cron: ${config.roundCron})`);

  const interval = setInterval(() => void loop.tick(), config.tickSecs * 1000);
  void loop.tick();

  const shutdown = () => {
    clearInterval(interval);
    void app.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
