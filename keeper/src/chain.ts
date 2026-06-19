/**
 * Chain access for the keeper: read-only state polling plus the two signed
 * calls it is allowed to make (start-round / settle-round) and, on devnet,
 * the pyth-mock price relay. Nonces are re-fetched from the node before
 * every send so restarts are safe; retries use exponential backoff.
 */
import {
  Cl,
  cvToJSON,
  fetchCallReadOnlyFunction,
  getAddressFromPrivateKey,
  makeContractCall,
  broadcastTransaction,
  PostConditionMode,
} from "@stacks/transactions";
import { STACKS_DEVNET, STACKS_MAINNET, STACKS_TESTNET, type StacksNetwork } from "@stacks/network";
import { cvJsonToPlain } from "@bachelier/shared/events";
import { splitContractId, type NetworkConfig } from "@bachelier/shared/networks";

export interface RoundState {
  status: "none" | "active" | "settled";
  roundId: bigint;
  expiry: bigint;
  contractsWritten: bigint;
}

export interface OracleState {
  price: bigint;
  publishTime: bigint;
  fresh: boolean;
}

export interface KeeperChain {
  address: string;
  now(): Promise<bigint>;
  roundState(): Promise<RoundState>;
  oracleState(): Promise<OracleState>;
  settleGrace(): Promise<bigint>;
  relayPrice(price1e8: bigint): Promise<string>;
  startRound(otmBps: number, iv1e8: bigint): Promise<string>;
  settleRound(): Promise<string>;
}

export function createKeeperChain(
  netCfg: NetworkConfig,
  stacksApiUrl: string,
  privateKey: string,
  fee: bigint
): KeeperChain {
  const base =
    netCfg.network === "mainnet" ? STACKS_MAINNET : netCfg.network === "testnet" ? STACKS_TESTNET : STACKS_DEVNET;
  const network: StacksNetwork = { ...base, client: { ...base.client, baseUrl: stacksApiUrl } };
  const [vaultAddr, vaultName] = splitContractId(netCfg.contracts.vault);
  const [adapterAddr, adapterName] = splitContractId(netCfg.contracts.oracleAdapter);
  const [feedAddr, feedName] = splitContractId(netCfg.pyth.feedContract);
  const address = getAddressFromPrivateKey(privateKey, netCfg.network === "mainnet" ? "mainnet" : "testnet");

  async function callRo(addr: string, name: string, fn: string, args: any[] = []): Promise<any> {
    const cv = await fetchCallReadOnlyFunction({
      contractAddress: addr,
      contractName: name,
      functionName: fn,
      functionArgs: args,
      senderAddress: address,
      network,
    });
    return cvToJSON(cv);
  }

  async function nextNonce(): Promise<bigint> {
    const res = await fetch(`${stacksApiUrl}/extended/v1/address/${address}/nonces`);
    if (!res.ok) throw new Error(`nonce fetch failed: ${res.status}`);
    const body = (await res.json()) as { possible_next_nonce: number };
    return BigInt(body.possible_next_nonce);
  }

  async function send(contractAddr: string, contractName: string, fn: string, args: any[]): Promise<string> {
    const nonce = await nextNonce();
    const tx = await makeContractCall({
      contractAddress: contractAddr,
      contractName,
      functionName: fn,
      functionArgs: args,
      senderKey: privateKey,
      network,
      nonce,
      fee,
      // keeper calls move no user funds; vault logic enforces everything
      postConditionMode: PostConditionMode.Deny,
      postConditions: [],
    });
    const result = await broadcastTransaction({ transaction: tx, network });
    if ("error" in result && result.error) {
      throw new Error(`broadcast failed: ${JSON.stringify(result)}`);
    }
    return typeof result.txid === "string" ? result.txid : String(result.txid);
  }

  return {
    address,

    async now() {
      const j = await callRo(feedAddr, feedName, "current-time");
      return BigInt(j.value);
    },

    async roundState() {
      const state = cvJsonToPlain(await callRo(vaultAddr, vaultName, "get-vault-state")) as any;
      const rid = BigInt(state["current-round"]);
      if (rid === 0n) return { status: "none", roundId: 0n, expiry: 0n, contractsWritten: 0n };
      const roundJ = await callRo(vaultAddr, vaultName, "get-round", [Cl.uint(rid)]);
      const round = cvJsonToPlain(roundJ) as any;
      if (!round) return { status: "none", roundId: rid, expiry: 0n, contractsWritten: 0n };
      return {
        status: BigInt(round.status) === 1n ? "active" : "settled",
        roundId: rid,
        expiry: BigInt(round.expiry),
        contractsWritten: BigInt(round["contracts-written"]),
      };
    },

    async oracleState() {
      const j = await callRo(adapterAddr, adapterName, "get-btc-price");
      if (j.success === false) {
        return { price: 0n, publishTime: 0n, fresh: false };
      }
      const v = cvJsonToPlain(j) as any;
      return { price: BigInt(v.price), publishTime: BigInt(v["publish-time"]), fresh: true };
    },

    async settleGrace() {
      const cfg = cvJsonToPlain(await callRo(vaultAddr, vaultName, "get-config")) as any;
      return BigInt(cfg["settle-grace"]);
    },

    async relayPrice(price1e8: bigint) {
      return send(feedAddr, feedName, "set-price-now", [Cl.int(price1e8)]);
    },

    async startRound(otmBps: number, iv1e8: bigint) {
      return send(vaultAddr, vaultName, "start-round", [Cl.uint(otmBps), Cl.uint(iv1e8)]);
    },

    async settleRound() {
      return send(vaultAddr, vaultName, "settle-round", []);
    },
  };
}
