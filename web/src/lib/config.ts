/**
 * Runtime configuration derived from Vite env vars + shared network config.
 * All env access is centralised here so components never touch import.meta.env.
 */
import { configWithDeployer, getNetworkConfig, type NetworkConfig } from "@bachelier/shared/networks";

// production builds (e.g. the Vercel deployment) default to testnet with no
// REST API -- the app then reads live state straight from the chain
// (lib/chainRead.ts); local dev defaults to devnet + localhost API.
const RAW_NETWORK =
  (import.meta.env.VITE_STACKS_NETWORK as string | undefined) ?? (import.meta.env.PROD ? "testnet" : "devnet");

export const NETWORK = (["devnet", "testnet", "mainnet"].includes(RAW_NETWORK) ? RAW_NETWORK : "devnet") as
  | "devnet"
  | "testnet"
  | "mainnet";

export const IS_DEVNET = NETWORK === "devnet";

/**
 * Network config (contract ids, token ids). After deploying to testnet, set
 * VITE_BACHELIER_DEPLOYER to the deployer principal so the build bakes in the
 * live contract addresses (Vite strips process.env, so the shared env() helper
 * can't see it at build time -- this Vite-native var is the override).
 */
const DEPLOYER_OVERRIDE = (import.meta.env.VITE_BACHELIER_DEPLOYER as string | undefined)?.trim();
export const cfg: NetworkConfig = DEPLOYER_OVERRIDE
  ? configWithDeployer(NETWORK, DEPLOYER_OVERRIDE)
  : getNetworkConfig(NETWORK);

/** Base URL for the read-only REST API; empty string = no API (chain-direct). */
export const API_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? (import.meta.env.PROD ? "" : "http://localhost:4000");

/**
 * The faucet button mints from the project's open-mint mock tokens. Enabled
 * whenever the configured tokens ARE those mocks (devnet always; testnet
 * until the vault is re-pointed at real sBTC/USDC).
 */
export const FAUCET_ENABLED: boolean =
  (import.meta.env.VITE_ENABLE_FAUCET as string | undefined) === "true" ||
  (NETWORK !== "mainnet" && cfg.tokens.sbtc.startsWith(`${cfg.deployer}.`));

/**
 * @stacks/connect network string. Stacks has no first-class "devnet" network
 * for the wallet API — devnet uses a local node but the wallet still speaks the
 * testnet address format, so we map devnet -> "testnet" for the connect call.
 */
export const STACKS_NETWORK: "testnet" | "mainnet" = NETWORK === "mainnet" ? "mainnet" : "testnet";

/** Explorer chain query param for building txid links. */
export const EXPLORER_CHAIN: string = NETWORK === "mainnet" ? "mainnet" : "testnet";

export function explorerTxUrl(txid: string): string {
  const id = txid.startsWith("0x") ? txid : `0x${txid}`;
  return `https://explorer.hiro.so/txid/${id}?chain=${EXPLORER_CHAIN}`;
}

/** Human label for the network badge. */
export const NETWORK_BADGE: string = NETWORK === "mainnet" ? "MAINNET" : NETWORK === "testnet" ? "TESTNET" : "DEVNET";
