import { getNetworkConfig } from "@bachelier/shared/networks";

const network = process.env.STACKS_NETWORK ?? "devnet";
const netCfg = getNetworkConfig(network);

export const config = {
  network,
  netCfg,
  port: Number(process.env.API_PORT ?? 4000),
  host: process.env.API_HOST ?? "0.0.0.0",
  databaseUrl: process.env.DATABASE_URL ?? "postgres://bachelier:bachelier@localhost:5432/bachelier",
  stacksApiUrl: process.env.STACKS_API_URL ?? netCfg.stacksApiUrl,
  corsOrigin: process.env.CORS_ORIGIN ?? true,
  /** pricing defaults mirrored from vault.clar config */
  riskFreeRate: Number(process.env.RISK_FREE_RATE ?? 0.04),
  roundLenSecs: Number(process.env.ROUND_LEN_SECS ?? 604_800),
  defaultIv: Number(process.env.DEFAULT_IV ?? 0.55),
  defaultOtmBps: Number(process.env.DEFAULT_OTM_BPS ?? 1000),
};
