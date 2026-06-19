/**
 * bs.ts parity tests: the reference table from the spec, plus the PINNED
 * on-chain outputs produced by bs-math.clar (verified in
 * contracts/tests/bs-math.test.ts). If either side drifts, this fails.
 */
import { describe, expect, it } from "vitest";
import { apyFromWeekly, bsCall, normCDF, quote } from "../src/bs.js";

// pinned fixtures: exact values returned by the deployed Clarity contract
const CLARITY_FIXTURES = [
  { s: 100, k: 100, sigma: 0.5, t: 1, r: 0, clarityFp: 1_974_128_000n },
  { s: 100, k: 100, sigma: 0.2, t: 1, r: 0.05, clarityFp: 1_045_057_400n },
  { s: 104_210, k: 114_631, sigma: 0.55, t: 7 / 365, r: 0.04, clarityFp: 42_848_661_381n },
];

describe("bsCall: spec reference table", () => {
  it("S=100 K=100 sig=0.5 T=1 r=0 -> ~19.74", () => {
    expect(bsCall(100, 100, 0.5, 1, 0)).toBeCloseTo(19.74, 1);
  });
  it("S=100 K=100 sig=0.2 T=1 r=0.05 -> ~10.45", () => {
    expect(bsCall(100, 100, 0.2, 1, 0.05)).toBeCloseTo(10.45, 1);
  });
  it("reference weekly call prices to ~$430 (within 0.5%)", () => {
    const c = bsCall(104_210, 114_631, 0.55, 7 / 365, 0.04);
    expect(Math.abs(c - 430)).toBeLessThanOrEqual(430 * 0.005);
  });
});

describe("bsCall: parity with the Clarity contract fixtures", () => {
  for (const f of CLARITY_FIXTURES) {
    it(`S=${f.s} K=${f.k} agrees with on-chain within 0.05%`, () => {
      const ts = bsCall(f.s, f.k, f.sigma, f.t, f.r);
      const clarity = Number(f.clarityFp) / 1e8;
      expect(Math.abs(ts - clarity) / clarity).toBeLessThan(0.0005);
    });
  }
});

describe("normCDF", () => {
  it("matches textbook values within the truncated-coefficient bound", () => {
    expect(normCDF(0)).toBeCloseTo(0.5, 5);
    expect(normCDF(1.96)).toBeCloseTo(0.975, 4);
    expect(normCDF(-1.96)).toBeCloseTo(0.025, 4);
    expect(normCDF(6)).toBeCloseTo(1, 6);
  });
});

describe("apyFromWeekly / quote", () => {
  it("weekly-compounds: reference inputs land in the 23-24% APY band", () => {
    const q = quote({ spot: 104_210, otmBps: 1000, iv: 0.55, tYears: 7 / 365, r: 0.04, contracts: 1 });
    expect(q.weeklyPct).toBeGreaterThan(0.004);
    expect(q.weeklyPct).toBeLessThan(0.0042);
    expect(q.apy).toBeGreaterThan(0.23);
    expect(q.apy).toBeLessThan(0.24);
    expect(q.strike).toBeCloseTo(104_210 * 1.1, 6);
    expect(q.capValue).toBeCloseTo(q.strike + q.premiumPerSbtcUsd, 8);
    expect(q.breakeven).toBeCloseTo(q.spot - q.premiumPerSbtcUsd, 8);
  });
  it("apyFromWeekly(0) is 0", () => {
    expect(apyFromWeekly(0)).toBe(0);
  });
});
