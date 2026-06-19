/**
 * Fixed-point conventions shared with the Clarity contracts.
 *
 * On-chain math uses 8-decimal fixed point: real v <-> BigInt(v * 1e8).
 * sBTC amounts are sats (1e8/sBTC); USDC amounts are micro-USDC (1e6/USDC)
 * in token transfers, converted to 1e8 internally for any math.
 */

export const ONE = 100_000_000n; // 1e8
export const FP_DECIMALS = 8;
export const SATS_PER_SBTC = 100_000_000n;
export const MICRO_PER_USDC = 1_000_000n;
export const SECONDS_PER_YEAR = 31_536_000;
export const CONTRACT_SIZE_SATS = 100_000_000n; // 1 contract covers 1 sBTC
/** vault premium index scale (micro-USDC * 1e12 per share-sat) */
export const ACC_SCALE = 1_000_000_000_000n;

/** number -> 1e8 fixed-point BigInt (rounds) */
export function toFp(v: number): bigint {
  return BigInt(Math.round(v * 1e8));
}

/** 1e8 fixed-point BigInt -> number */
export function fromFp(v: bigint): number {
  return Number(v) / 1e8;
}

/** USD 1e8 fixed-point -> micro-USDC (1e6), matching vault.clar's `/ u100` */
export function usdFpToMicroUsdc(v: bigint): bigint {
  return v / 100n;
}

export function microUsdcToUsd(v: bigint): number {
  return Number(v) / 1e6;
}

export function satsToSbtc(v: bigint): number {
  return Number(v) / 1e8;
}

export function sbtcToSats(v: number): bigint {
  return BigInt(Math.round(v * 1e8));
}
