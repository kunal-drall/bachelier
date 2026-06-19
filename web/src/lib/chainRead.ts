/**
 * Chain-direct fallbacks: when the REST API is unreachable (e.g. the static
 * Vercel deployment runs without the indexer/API stack), the app reads the
 * essential live state straight from the Stacks node via read-only calls.
 * Indexed history (deposits list, rounds table, charts) stays empty -- only
 * the API can serve that -- but prices, vault state, the live round, and the
 * connected user's position remain fully functional.
 */
import { Cl, cvToJSON, fetchCallReadOnlyFunction } from "@stacks/transactions";
import { STACKS_MAINNET, STACKS_TESTNET, type StacksNetwork } from "@stacks/network";
import { apyFromWeekly, bsCall } from "@bachelier/shared/bs";
import { splitContractId } from "@bachelier/shared/networks";
import type { PriceDto, UserPositionsDto, VaultDto, RoundSummaryDto } from "@bachelier/shared/dto";
import { cfg, NETWORK } from "./config";

const base = NETWORK === "mainnet" ? STACKS_MAINNET : STACKS_TESTNET;
const network: StacksNetwork = { ...base, client: { ...base.client, baseUrl: cfg.stacksApiUrl } };

const [vaultAddr, vaultName] = splitContractId(cfg.contracts.vault);
const [feedAddr, feedName] = splitContractId(cfg.pyth.feedContract);

async function ro(addr: string, name: string, fn: string, args: unknown[] = []): Promise<any> {
  const cv = await fetchCallReadOnlyFunction({
    contractAddress: addr,
    contractName: name,
    functionName: fn,
    functionArgs: args as never[],
    senderAddress: vaultAddr,
    network,
  });
  return cvToJSON(cv);
}

const u = (node: any): bigint => BigInt(node.value);

/** BTC-USD read straight from the feed (display even if flagged stale). */
export async function chainPrice(): Promise<PriceDto> {
  const j = await ro(feedAddr, feedName, "get-price");
  return {
    btcUsd: Number(u(j.value.price)) / 1e8,
    publishTime: Number(u(j.value["publish-time"])),
    source: "chain",
  };
}

function roundFromChain(id: number, r: any): RoundSummaryDto {
  const v = r.value.value;
  const status = u(v.status) === 1n ? "active" : "settled";
  return {
    roundId: id,
    status,
    strike: u(v.strike).toString(),
    iv: u(v.iv).toString(),
    spotOpen: u(v["spot-open"]).toString(),
    openedAt: Number(u(v["opened-at"])),
    expiry: Number(u(v.expiry)),
    contractsWritten: u(v["contracts-written"]).toString(),
    premiumCollectedUsdc: u(v["premium-collected"]).toString(),
    settlementPrice: status === "settled" ? u(v["settlement-price"]).toString() : null,
    payoutPerContract: status === "settled" ? u(v["payout-per-contract"]).toString() : null,
    sbtcPaidOut: status === "settled" ? u(v["sbtc-paid-out"]).toString() : null,
  };
}

/** Vault summary assembled from get-vault-state + the current round. */
export async function chainVault(): Promise<VaultDto> {
  const j = await ro(vaultAddr, vaultName, "get-vault-state");
  const s = j.value;
  const currentRoundId = Number(u(s["current-round"]));

  let currentRound: RoundSummaryDto | null = null;
  if (currentRoundId > 0) {
    const r = await ro(vaultAddr, vaultName, "get-round", [Cl.uint(currentRoundId)]);
    if (r.value !== null) {
      const summary = roundFromChain(currentRoundId, r);
      if (summary.status === "active") currentRound = summary;
    }
  }

  let btcUsd: number | null = null;
  try {
    btcUsd = (await chainPrice()).btcUsd;
  } catch {
    btcUsd = null;
  }

  // forward APY from the live round params (same formula as the API)
  let forwardApy: number | null = null;
  if (btcUsd && currentRound) {
    const prem = bsCall(btcUsd, Number(currentRound.strike) / 1e8, Number(currentRound.iv) / 1e8, 7 / 365, 0.04);
    if (Number.isFinite(prem) && prem > 0) forwardApy = apyFromWeekly(prem / btcUsd);
  }

  return {
    tvlSbtc: u(s["total-collateral-sbtc"]).toString(),
    reservedPayoutSbtc: u(s["reserved-payout-sbtc"]).toString(),
    totalShares: u(s["total-shares"]).toString(),
    sharePrice: u(s["share-price"]).toString(),
    premiumPoolUsdc: u(s["premium-pool-usdc"]).toString(),
    cumulativePremiumUsdc: u(s["cumulative-premium-usdc"]).toString(),
    currentRound,
    trailingApy: null, // requires the indexer
    forwardApy,
    capacitySbtc: (u(s["contracts-available"]) * 100_000_000n).toString(),
    btcUsd,
  };
}

/** The connected user's live position from vault.get-user (no history). */
export async function chainPositions(address: string): Promise<UserPositionsDto> {
  const j = await ro(vaultAddr, vaultName, "get-user", [Cl.principal(address)]);
  const v = j.value;
  return {
    address,
    shares: u(v.shares).toString(),
    valueSbtc: u(v["value-sbtc"]).toString(),
    claimablePremiumUsdc: u(v["claimable-premium-usdc"]).toString(),
    queuedShares: u(v["queued-shares"]).toString(),
    deposits: [], // indexed history needs the API
    takerPositions: [],
  };
}
