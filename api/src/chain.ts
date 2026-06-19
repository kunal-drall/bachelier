/**
 * Optional live chain reads. Every method returns null on failure so the
 * API degrades to indexed data when the node is unreachable -- routes must
 * never 500 because the chain is down.
 */
import { Cl, cvToJSON, fetchCallReadOnlyFunction } from "@stacks/transactions";
import { STACKS_TESTNET, STACKS_MAINNET, STACKS_DEVNET, type StacksNetwork } from "@stacks/network";
import { cvJsonToPlain } from "@bachelier/shared/events";
import { splitContractId, type NetworkConfig } from "@bachelier/shared/networks";

export interface ChainUser {
  shares: bigint;
  valueSbtc: bigint;
  claimablePremiumUsdc: bigint;
  queuedShares: bigint;
}

export interface ChainQuote {
  spot: bigint;
  strike: bigint;
  premiumPerContractUsdc: bigint;
}

export interface ChainPrice {
  btcUsd: bigint;
  publishTime: number;
}

export interface ChainReader {
  getUser(address: string): Promise<ChainUser | null>;
  previewQuote(otmBps: number, iv1e8: bigint, contracts: number): Promise<ChainQuote | null>;
  readPrice(): Promise<ChainPrice | null>;
}

export function createChainReader(netCfg: NetworkConfig, stacksApiUrl: string): ChainReader {
  const base =
    netCfg.network === "mainnet" ? STACKS_MAINNET : netCfg.network === "testnet" ? STACKS_TESTNET : STACKS_DEVNET;
  const network: StacksNetwork = { ...base, client: { ...base.client, baseUrl: stacksApiUrl } };
  const [vaultAddr, vaultName] = splitContractId(netCfg.contracts.vault);
  const [adapterAddr, adapterName] = splitContractId(netCfg.contracts.oracleAdapter);

  async function callRo(addr: string, name: string, fn: string, args: any[]): Promise<any | null> {
    try {
      const cv = await fetchCallReadOnlyFunction({
        contractAddress: addr,
        contractName: name,
        functionName: fn,
        functionArgs: args,
        senderAddress: vaultAddr,
        network,
      });
      const json = cvToJSON(cv);
      if (json.success === false) return null;
      return cvJsonToPlain(json);
    } catch {
      return null;
    }
  }

  return {
    async getUser(address: string) {
      const plain = await callRo(vaultAddr, vaultName, "get-user", [Cl.principal(address)]);
      if (!plain) return null;
      return {
        shares: BigInt(plain["shares"]),
        valueSbtc: BigInt(plain["value-sbtc"]),
        claimablePremiumUsdc: BigInt(plain["claimable-premium-usdc"]),
        queuedShares: BigInt(plain["queued-shares"]),
      };
    },
    async previewQuote(otmBps: number, iv1e8: bigint, contracts: number) {
      const plain = await callRo(vaultAddr, vaultName, "preview-quote", [
        Cl.uint(otmBps),
        Cl.uint(iv1e8),
        Cl.uint(contracts),
      ]);
      if (!plain) return null;
      return {
        spot: BigInt(plain["spot"]),
        strike: BigInt(plain["strike"]),
        premiumPerContractUsdc: BigInt(plain["premium-per-contract-usdc"]),
      };
    },
    async readPrice() {
      const plain = await callRo(adapterAddr, adapterName, "get-btc-price", []);
      if (!plain) return null;
      return { btcUsd: BigInt(plain["price"]), publishTime: Number(plain["publish-time"]) };
    },
  };
}

/** chain reader that always misses -- for tests and chainless deployments */
export const nullChainReader: ChainReader = {
  getUser: async () => null,
  previewQuote: async () => null,
  readPrice: async () => null,
};
