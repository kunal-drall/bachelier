/**
 * Network-keyed deployment config. Devnet principals are the Clarinet
 * defaults; testnet/mainnet principals are filled in at deploy time (the
 * deployed addresses are recorded here, per spec section 9).
 */

export type BachelierNetwork = "devnet" | "testnet" | "mainnet";

export interface NetworkConfig {
  network: BachelierNetwork;
  stacksApiUrl: string;
  /** principal that deployed the Bachelier contracts */
  deployer: string;
  contracts: {
    bsMath: string;
    oracleAdapter: string;
    bcshareToken: string;
    vault: string;
  };
  tokens: {
    /** SIP-010 sBTC contract id (mock on devnet) */
    sbtc: string;
    /** SIP-010 USDC contract id (mock on devnet) */
    usdc: string;
    sbtcDecimals: number;
    usdcDecimals: number;
  };
  pyth: {
    /** Pyth BTC/USD price feed id */
    btcUsdFeedId: string;
    /** price feed contract (mock on devnet) */
    feedContract: string;
  };
}

const DEVNET_DEPLOYER = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";

/** browser-safe env lookup (vite injects import.meta.env, node has process) */
function env(key: string): string | undefined {
  if (typeof process !== "undefined" && typeof process.env === "object") {
    return process.env[key];
  }
  return undefined;
}

export const NETWORKS: Record<BachelierNetwork, NetworkConfig> = {
  devnet: {
    network: "devnet",
    stacksApiUrl: "http://localhost:3999",
    deployer: DEVNET_DEPLOYER,
    contracts: {
      bsMath: `${DEVNET_DEPLOYER}.bs-math`,
      oracleAdapter: `${DEVNET_DEPLOYER}.oracle-adapter`,
      bcshareToken: `${DEVNET_DEPLOYER}.bcshare-token`,
      vault: `${DEVNET_DEPLOYER}.vault`,
    },
    tokens: {
      sbtc: `${DEVNET_DEPLOYER}.sbtc-token`,
      usdc: `${DEVNET_DEPLOYER}.usdc-token`,
      sbtcDecimals: 8,
      usdcDecimals: 6,
    },
    pyth: {
      btcUsdFeedId: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
      feedContract: `${DEVNET_DEPLOYER}.pyth-mock`,
    },
  },
  testnet: {
    network: "testnet",
    stacksApiUrl: "https://api.testnet.hiro.so",
    // Filled in at deploy time (see deployments/default.testnet-plan.yaml).
    // Override via env BACHELIER_DEPLOYER for ad-hoc deployments.
    deployer: env("BACHELIER_DEPLOYER") ?? "ST000000000000000000002AMW42H",
    contracts: {
      bsMath: addr("bs-math"),
      oracleAdapter: addr("oracle-adapter"),
      bcshareToken: addr("bcshare-token"),
      vault: addr("vault"),
    },
    tokens: {
      // Project-deployed SIP-010 mocks (open mint = faucet for testers); the
      // deployed vault's token config points at these. Re-point to the real
      // testnet sBTC / a canonical USDC via env + vault.set-tokens before
      // accepting real deposits.
      sbtc: env("BACHELIER_SBTC") ?? addr("sbtc-token"),
      usdc: env("BACHELIER_USDC") ?? addr("usdc-token"),
      sbtcDecimals: 8,
      usdcDecimals: 6,
    },
    pyth: {
      btcUsdFeedId: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
      feedContract: env("BACHELIER_PRICE_FEED") ?? addr("pyth-mock"),
    },
  },
  mainnet: {
    network: "mainnet",
    stacksApiUrl: "https://api.hiro.so",
    deployer: env("BACHELIER_DEPLOYER") ?? "SP000000000000000000002Q6VF78",
    contracts: {
      bsMath: addr("bs-math"),
      oracleAdapter: addr("oracle-adapter"),
      bcshareToken: addr("bcshare-token"),
      vault: addr("vault"),
    },
    tokens: {
      sbtc: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token",
      usdc: env("BACHELIER_USDC") ?? addr("usdc-token"),
      sbtcDecimals: 8,
      usdcDecimals: 6,
    },
    pyth: {
      btcUsdFeedId: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
      feedContract: env("BACHELIER_PRICE_FEED") ?? addr("pyth-mock"),
    },
  },
};

function addr(contract: string): string {
  const deployer = env("BACHELIER_DEPLOYER") ?? "ST000000000000000000002AMW42H";
  return `${deployer}.${contract}`;
}

export function getNetworkConfig(network: string | undefined): NetworkConfig {
  const n = (network ?? "devnet") as BachelierNetwork;
  const cfg = NETWORKS[n];
  if (!cfg) throw new Error(`unknown network: ${network}`);
  return cfg;
}

/**
 * Rebuild a network config with an explicit deployer principal. In our
 * self-contained testnet deployment every contract/token/feed lives under the
 * one deployer, so this derives the whole address set from it. Used by the web
 * build (VITE_BACHELIER_DEPLOYER) and the services (BACHELIER_DEPLOYER) once
 * the contracts are live -- this avoids relying on `process.env` at build time,
 * which Vite strips from the browser bundle.
 */
export function configWithDeployer(network: BachelierNetwork, deployer: string): NetworkConfig {
  const base = NETWORKS[network];
  const a = (c: string) => `${deployer}.${c}`;
  return {
    ...base,
    deployer,
    contracts: {
      bsMath: a("bs-math"),
      oracleAdapter: a("oracle-adapter"),
      bcshareToken: a("bcshare-token"),
      vault: a("vault"),
    },
    tokens: { ...base.tokens, sbtc: a("sbtc-token"), usdc: a("usdc-token") },
    pyth: { ...base.pyth, feedContract: a("pyth-mock") },
  };
}

/** Split "SP....contract-name" into [address, name]. */
export function splitContractId(id: string): [string, string] {
  const [address, name] = id.split(".");
  if (!address || !name) throw new Error(`bad contract id: ${id}`);
  return [address, name];
}
