/**
 * Black-Scholes TS mirror - verbatim port of the prototype's JS pricer.
 *
 * This is the reference implementation that `bs-math.clar` must match
 * numerically (see contracts/tests/bs-math.test.ts parity gates). It powers
 * the API `/quote` endpoint and the web app's instant builder feedback.
 *
 * Abramowitz-Stegun 7.1.26 with the prototype's truncated coefficients --
 * keep these EXACTLY in sync with the constants in bs-math.clar.
 */

/** Standard normal CDF (Abramowitz-Stegun 7.1.26, prototype coefficients). */
export function normCDF(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

/**
 * European call price.
 *   d1 = (ln(S/K) + (r + sig^2/2) T) / (sig sqrt(T))
 *   d2 = d1 - sig sqrt(T)
 *   C  = S N(d1) - K e^(-rT) N(d2)
 */
export function bsCall(S: number, K: number, sig: number, T: number, r: number): number {
  const d1 = (Math.log(S / K) + (r + (sig * sig) / 2) * T) / (sig * Math.sqrt(T));
  const d2 = d1 - sig * Math.sqrt(T);
  return S * normCDF(d1) - K * Math.exp(-r * T) * normCDF(d2);
}

/** Weekly-compounded APY from a weekly yield fraction (e.g. 0.0041 -> ~0.238). */
export function apyFromWeekly(weeklyPct: number): number {
  return Math.pow(1 + weeklyPct, 52) - 1;
}

/** Convenience quote used by the API and UI builder. */
export interface QuoteInputs {
  /** Spot BTC-USD */
  spot: number;
  /** Out-of-the-money offset in basis points (1000 = +10%) */
  otmBps: number;
  /** Implied volatility, e.g. 0.55 */
  iv: number;
  /** Time to expiry in years (weekly default 7/365) */
  tYears: number;
  /** Risk-free rate, e.g. 0.04 */
  r: number;
  /** Number of 1-sBTC contracts */
  contracts: number;
}

export interface QuoteResult {
  spot: number;
  strike: number;
  premiumPerSbtcUsd: number;
  premiumTotalUsd: number;
  /** premium / spot for the round length */
  weeklyPct: number;
  /** weekly-compounded APY */
  apy: number;
  /** strike/spot - 1 */
  downsideCushionPct: number;
  /** spot at which the seller's covered-call return hits zero vs holding */
  breakeven: number;
  /** value per contract if called away at the cap: K + premium */
  capValue: number;
}

export function quote(i: QuoteInputs): QuoteResult {
  const strike = i.spot * (1 + i.otmBps / 10000);
  const prem = bsCall(i.spot, strike, i.iv, i.tYears, i.r);
  const weeklyPct = prem / i.spot;
  return {
    spot: i.spot,
    strike,
    premiumPerSbtcUsd: prem,
    premiumTotalUsd: prem * i.contracts,
    weeklyPct,
    apy: apyFromWeekly(weeklyPct),
    downsideCushionPct: prem / i.spot,
    breakeven: i.spot - prem,
    capValue: strike + prem,
  };
}
