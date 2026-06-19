/**
 * Zod schemas for every API request/response DTO. The API validates its
 * responses against these; the web app parses with them. Amount fields that
 * are on-chain integers travel as strings to avoid float loss.
 */
import { z } from "zod";

export const bigintString = z.string().regex(/^-?\d+$/, "expected integer string");

// --- /health ---------------------------------------------------------------
export const HealthDto = z.object({
  ok: z.boolean(),
  lastIndexedBlock: z.number().int().nullable(),
});
export type HealthDto = z.infer<typeof HealthDto>;

// --- /vault ------------------------------------------------------------------
export const RoundSummaryDto = z.object({
  roundId: z.number().int(),
  status: z.enum(["active", "settled"]),
  strike: bigintString, // USD 1e8
  iv: bigintString, // 1e8
  spotOpen: bigintString.nullable(),
  openedAt: z.number().int(),
  expiry: z.number().int(),
  contractsWritten: bigintString,
  premiumCollectedUsdc: bigintString, // micro-USDC
  settlementPrice: bigintString.nullable(),
  payoutPerContract: bigintString.nullable(), // sats
  sbtcPaidOut: bigintString.nullable(), // sats
});
export type RoundSummaryDto = z.infer<typeof RoundSummaryDto>;

export const VaultDto = z.object({
  tvlSbtc: bigintString, // sats
  reservedPayoutSbtc: bigintString, // sats
  totalShares: bigintString,
  sharePrice: bigintString, // sats per share, 1e8 fp
  premiumPoolUsdc: bigintString, // micro-USDC
  cumulativePremiumUsdc: bigintString,
  currentRound: RoundSummaryDto.nullable(),
  trailingApy: z.number().nullable(), // realized, trailing window
  forwardApy: z.number().nullable(), // from current round quote
  capacitySbtc: bigintString, // contracts still writable, in sats
  btcUsd: z.number().nullable(),
});
export type VaultDto = z.infer<typeof VaultDto>;

// --- /vault/history -----------------------------------------------------------
export const SnapshotDto = z.object({
  ts: z.number().int(),
  blockHeight: z.number().int(),
  tvlSbtc: bigintString,
  totalShares: bigintString,
  sharePrice: bigintString,
  premiumPoolUsdc: bigintString,
  cumulativePremiumUsdc: bigintString,
  apy: z.number().nullable(),
});
export type SnapshotDto = z.infer<typeof SnapshotDto>;

export const VaultHistoryDto = z.object({
  range: z.string(),
  interval: z.string(),
  points: z.array(SnapshotDto),
});
export type VaultHistoryDto = z.infer<typeof VaultHistoryDto>;

// --- /rounds -------------------------------------------------------------------
export const PositionDto = z.object({
  roundId: z.number().int(),
  buyer: z.string(),
  contracts: bigintString,
  premiumPaidUsdc: bigintString,
  strike: bigintString,
  settled: z.boolean(),
  payoutSbtc: bigintString.nullable(),
});
export type PositionDto = z.infer<typeof PositionDto>;

export const RoundDetailDto = RoundSummaryDto.extend({
  positions: z.array(PositionDto),
  buyers: z.number().int(),
});
export type RoundDetailDto = z.infer<typeof RoundDetailDto>;

export const RoundsPageDto = z.object({
  rounds: z.array(RoundSummaryDto),
  nextCursor: z.number().int().nullable(),
});
export type RoundsPageDto = z.infer<typeof RoundsPageDto>;

// --- /positions/:address --------------------------------------------------------
export const DepositRowDto = z.object({
  amountSbtc: bigintString,
  shares: bigintString,
  roundId: z.number().int().nullable(),
  txId: z.string(),
  blockHeight: z.number().int(),
  ts: z.number().int().nullable(),
});
export type DepositRowDto = z.infer<typeof DepositRowDto>;

export const UserPositionsDto = z.object({
  address: z.string(),
  shares: bigintString,
  valueSbtc: bigintString,
  claimablePremiumUsdc: bigintString,
  queuedShares: bigintString,
  deposits: z.array(DepositRowDto),
  takerPositions: z.array(PositionDto),
});
export type UserPositionsDto = z.infer<typeof UserPositionsDto>;

// --- /quote ------------------------------------------------------------------------
export const QuoteQueryDto = z.object({
  notional: z.coerce.number().positive().default(1), // contracts (1 sBTC each)
  otmBps: z.coerce.number().int().min(0).max(10000).default(1000),
  iv: z.coerce.number().positive().max(5).default(0.55),
});
export type QuoteQueryDto = z.infer<typeof QuoteQueryDto>;

export const QuoteDto = z.object({
  spot: z.number(),
  strike: z.number(),
  premiumPerSbtcUsdc: z.number(),
  premiumTotalUsdc: z.number(),
  weeklyPct: z.number(),
  apy: z.number(),
  downsideCushionPct: z.number(),
  breakeven: z.number(),
  capValue: z.number(),
  tYears: z.number(),
  r: z.number(),
  /** on-chain preview-quote parity (when reachable) */
  onChain: z
    .object({
      premiumPerSbtcUsdc: z.number(),
      strike: z.number(),
      agreesWithinPct: z.number(),
    })
    .nullable(),
});
export type QuoteDto = z.infer<typeof QuoteDto>;

// --- /price ---------------------------------------------------------------------------
export const PriceDto = z.object({
  btcUsd: z.number(),
  publishTime: z.number().int(),
  source: z.string(),
});
export type PriceDto = z.infer<typeof PriceDto>;

// --- /tx/:txid -------------------------------------------------------------------------
export const TxStatusDto = z.object({
  txId: z.string(),
  status: z.enum(["pending", "success", "abort_by_response", "abort_by_post_condition", "not_found"]),
  blockHeight: z.number().int().nullable(),
});
export type TxStatusDto = z.infer<typeof TxStatusDto>;
