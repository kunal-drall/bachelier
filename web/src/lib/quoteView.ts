/**
 * Reconciles the instant local Black–Scholes estimate with the authoritative
 * /quote response into a single view model. Prefers remote values when present;
 * falls back to the local estimate so the UI never shows empty numbers while
 * the debounced request is in flight.
 */
import type { QuoteResult } from "@bachelier/shared/bs";
import type { QuoteDto } from "@bachelier/shared/dto";

export interface QuoteView {
  source: "api" | "local" | "none";
  spot: number | null;
  strike: number | null;
  premiumPerSbtc: number | null;
  premiumTotal: number | null;
  apy: number | null;
  weeklyPct: number | null;
  downsideCushionPct: number | null;
  breakeven: number | null;
  capValue: number | null;
  /** on-chain parity info, only from the API */
  onChain: QuoteDto["onChain"] | null;
}

export function reconcileQuote(local: QuoteResult | null, remote: QuoteDto | undefined): QuoteView {
  if (remote) {
    return {
      source: "api",
      spot: remote.spot,
      strike: remote.strike,
      premiumPerSbtc: remote.premiumPerSbtcUsdc,
      premiumTotal: remote.premiumTotalUsdc,
      apy: remote.apy,
      weeklyPct: remote.weeklyPct,
      downsideCushionPct: remote.downsideCushionPct,
      breakeven: remote.breakeven,
      capValue: remote.capValue,
      onChain: remote.onChain,
    };
  }
  if (local) {
    return {
      source: "local",
      spot: local.spot,
      strike: local.strike,
      premiumPerSbtc: local.premiumPerSbtcUsd,
      premiumTotal: local.premiumTotalUsd,
      apy: local.apy,
      weeklyPct: local.weeklyPct,
      downsideCushionPct: local.downsideCushionPct,
      breakeven: local.breakeven,
      capValue: local.capValue,
      onChain: null,
    };
  }
  return {
    source: "none",
    spot: null,
    strike: null,
    premiumPerSbtc: null,
    premiumTotal: null,
    apy: null,
    weeklyPct: null,
    downsideCushionPct: null,
    breakeven: null,
    capValue: null,
    onChain: null,
  };
}
