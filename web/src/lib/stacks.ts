/**
 * Stacks wallet (connect v8) + contract-call builders with post-conditions.
 *
 * All chain amounts are BigInt. Post-conditions are constructed with the `Pc`
 * fluent builder from @stacks/transactions v7; function args with `Cl`.
 * Contract calls are dispatched through connect's `request('stx_callContract')`.
 */
import { connect, disconnect, isConnected, getLocalStorage, request } from "@stacks/connect";
import { Cl, Pc } from "@stacks/transactions";
import { splitContractId } from "@bachelier/shared/networks";
import { cfg, STACKS_NETWORK } from "./config";

// --- wallet session --------------------------------------------------------

export interface WalletState {
  address: string | null;
}

/** Read the connected STX address from connect's local storage, if any. */
export function getStxAddress(): string | null {
  try {
    if (!isConnected()) return null;
    const data = getLocalStorage();
    const addr = data?.addresses?.stx?.[0]?.address;
    return addr ?? null;
  } catch {
    return null;
  }
}

export async function connectWallet(): Promise<string | null> {
  await connect();
  return getStxAddress();
}

export function disconnectWallet(): void {
  disconnect();
}

export { isConnected };

// --- shared helpers --------------------------------------------------------

const VAULT_ID = cfg.contracts.vault;
const SBTC_ID = cfg.tokens.sbtc;
const USDC_ID = cfg.tokens.usdc;

const SBTC_ASSET = "sbtc";
const USDC_ASSET = "usdc";

const MICRO_PER_USDC = 1_000_000n;

/** A trait-reference function arg is the token's contract principal. */
function tokenTraitArg(contractId: string) {
  const [addr, name] = splitContractId(contractId);
  return Cl.contractPrincipal(addr, name);
}

export interface CallResult {
  txid: string;
}

/** Normalize connect's response (`{ txid }`) into our CallResult. */
function asResult(res: unknown): CallResult {
  const r = res as { txid?: string; txId?: string };
  const txid = r?.txid ?? r?.txId;
  if (!txid) throw new Error("wallet did not return a txid");
  return { txid };
}

async function callVault(functionName: string, functionArgs: unknown[], postConditions: unknown[]): Promise<CallResult> {
  const res = await request("stx_callContract", {
    contract: VAULT_ID as `${string}.${string}`,
    functionName,
    // connect v8 serializes Cl values / Pc post-conditions internally.
    functionArgs: functionArgs as never,
    postConditions: postConditions as never,
    postConditionMode: "deny",
    network: STACKS_NETWORK,
  });
  return asResult(res);
}

// --- vault writes ----------------------------------------------------------

/** deposit(amount uint, sbtc trait-ref). PC: sender sends exactly `amount` sBTC. */
export async function deposit(address: string, amountSats: bigint): Promise<CallResult> {
  const pc = Pc.principal(address).willSendEq(amountSats).ft(SBTC_ID as `${string}.${string}`, SBTC_ASSET);
  return callVault("deposit", [Cl.uint(amountSats), tokenTraitArg(SBTC_ID)], [pc]);
}

/** withdraw(shares uint, sbtc trait-ref). PC: vault sends >= 1 sat sBTC. */
export async function withdraw(shares: bigint): Promise<CallResult> {
  const pc = Pc.principal(VAULT_ID).willSendGte(1n).ft(SBTC_ID as `${string}.${string}`, SBTC_ASSET);
  return callVault("withdraw", [Cl.uint(shares), tokenTraitArg(SBTC_ID)], [pc]);
}

/** request-withdraw(shares uint). No token movement -> no FT post-condition. */
export async function requestWithdraw(shares: bigint): Promise<CallResult> {
  return callVault("request-withdraw", [Cl.uint(shares)], []);
}

/** cancel-withdraw-request(shares uint). */
export async function cancelWithdrawRequest(shares: bigint): Promise<CallResult> {
  return callVault("cancel-withdraw-request", [Cl.uint(shares)], []);
}

/** claim-premium(usdc trait-ref). PC: vault sends >= 1 micro-USDC. */
export async function claimPremium(): Promise<CallResult> {
  const pc = Pc.principal(VAULT_ID).willSendGte(1n).ft(USDC_ID as `${string}.${string}`, USDC_ASSET);
  return callVault("claim-premium", [tokenTraitArg(USDC_ID)], [pc]);
}

/**
 * buy-call(contracts uint, usdc trait-ref). PC: user sends <= maxPremium USDC.
 * maxPremium = ceil(premiumTotalUsdc * 1.02) in micro-USDC (2% slippage guard).
 */
export async function buyCall(address: string, contracts: bigint, premiumTotalUsdc: number): Promise<CallResult> {
  const maxPremium = maxPremiumMicroUsdc(premiumTotalUsdc);
  const pc = Pc.principal(address).willSendLte(maxPremium).ft(USDC_ID as `${string}.${string}`, USDC_ASSET);
  return callVault("buy-call", [Cl.uint(contracts), tokenTraitArg(USDC_ID)], [pc]);
}

/** exercise(round-id uint, sbtc trait-ref). */
export async function exercise(roundId: bigint): Promise<CallResult> {
  const pc = Pc.principal(VAULT_ID).willSendGte(1n).ft(SBTC_ID as `${string}.${string}`, SBTC_ASSET);
  return callVault("exercise", [Cl.uint(roundId), tokenTraitArg(SBTC_ID)], [pc]);
}

/**
 * Mock-token faucet (devnet only). Mock tokens expose `mint(amount, recipient)`.
 * Mints to the connected wallet; returns both txids.
 */
export async function faucetMint(address: string): Promise<{ sbtc: CallResult; usdc: CallResult }> {
  const oneSbtc = 100_000_000n; // 1 sBTC in sats
  const tenKUsdc = 10_000n * MICRO_PER_USDC; // 10,000 USDC in micro

  const mint = async (contractId: string, amount: bigint): Promise<CallResult> => {
    const res = await request("stx_callContract", {
      contract: contractId as `${string}.${string}`,
      functionName: "mint",
      functionArgs: [Cl.uint(amount), Cl.principal(address)] as never,
      postConditions: [] as never,
      postConditionMode: "allow",
      network: STACKS_NETWORK,
    });
    return asResult(res);
  };

  const sbtc = await mint(SBTC_ID, oneSbtc);
  const usdc = await mint(USDC_ID, tenKUsdc);
  return { sbtc, usdc };
}

// --- pure helpers (exported for tests) -------------------------------------

/** ceil(premiumTotalUsdc * 1.02) expressed in micro-USDC, as BigInt. */
export function maxPremiumMicroUsdc(premiumTotalUsdc: number): bigint {
  if (!Number.isFinite(premiumTotalUsdc) || premiumTotalUsdc <= 0) return 0n;
  // work in micro-USDC, apply 2% guard, round up
  const microFloat = premiumTotalUsdc * 1.02 * 1_000_000;
  return BigInt(Math.ceil(microFloat));
}
