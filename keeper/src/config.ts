import { getNetworkConfig } from "@bachelier/shared/networks";

const network = process.env.STACKS_NETWORK ?? "devnet";
const netCfg = getNetworkConfig(network);

export const config = {
  network,
  netCfg,
  port: Number(process.env.KEEPER_PORT ?? 4002),
  host: process.env.KEEPER_HOST ?? "0.0.0.0",
  stacksApiUrl: process.env.STACKS_API_URL ?? netCfg.stacksApiUrl,
  /** hex private key; NEVER commit. Isolated from the API process. */
  privateKey: process.env.KEEPER_PRIVATE_KEY ?? "",
  /** round parameters */
  otmBps: Number(process.env.OTM_BPS ?? 1000),
  iv1e8: BigInt(process.env.IV_1E8 ?? 55_000_000),
  /** cron for opening rounds: Fridays 08:00 UTC (matches the round expiry) */
  roundCron: process.env.ROUND_CRON ?? "0 8 * * 5",
  /** when true, also start a round on boot if none is active (devnet UX) */
  startOnBoot: (process.env.START_ON_BOOT ?? (network === "devnet" ? "true" : "false")) === "true",
  /** poll cadence for settle checks */
  tickSecs: Number(process.env.TICK_SECS ?? 60),
  /** devnet: push prices into pyth-mock before start/settle */
  priceRelay: (process.env.PRICE_RELAY ?? (network === "devnet" ? "true" : "false")) === "true",
  /** optional external BTC-USD source for the relay */
  priceSourceUrl: process.env.PRICE_SOURCE_URL ?? "",
  fee: BigInt(process.env.TX_FEE_USTX ?? 10_000),
  maxRetries: Number(process.env.MAX_RETRIES ?? 5),
};

export function requireKey(): string {
  if (!config.privateKey) throw new Error("KEEPER_PRIVATE_KEY is not set");
  return config.privateKey;
}
