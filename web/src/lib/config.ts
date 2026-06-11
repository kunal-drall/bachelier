/**
 * Runtime configuration derived from Vite env vars + shared network config.
 * All env access is centralised here so components never touch import.meta.env.
 */
import { getNetworkConfig, type NetworkConfig } from "@bachelier/shared/networks";

const RAW_NETWORK = (import.meta.env.VITE_STACKS_NETWORK as string | undefined) ?? "devnet";

export const NETWORK = (["devnet", "testnet", "mainnet"].includes(RAW_NETWORK) ? RAW_NETWORK : "devnet") as
  | "devnet"
  | "testnet"
  | "mainnet";

export const IS_DEVNET = NETWORK === "devnet";

/** Network config (contract ids, token ids) from the shared package. */
export const cfg: NetworkConfig = getNetworkConfig(NETWORK);

/** Base URL for the read-only REST API. */
export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:4000";

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
