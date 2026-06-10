import { describe, expect, it } from "vitest";
import { Cl, cvToJSON } from "@stacks/transactions";
import { bsCall, normCDF } from "@bachelier/shared/bs";
import { deployer, bsCallPriceFp } from "./helpers";

const ONE = 100_000_000n;

function roInt(fn: string, args: any[]): bigint {
  const res = simnet.callReadOnlyFn("bs-math", fn, args, deployer);
  const j = cvToJSON(res.result);
  return BigInt(j.value);
}

function fp(v: number): bigint {
  return BigInt(Math.round(v * 1e8));
}

describe("bs-math: fixed-point primitives", () => {
  it("fp-mul multiplies at 1e8 scale (incl. negatives)", () => {
    expect(roInt("fp-mul", [Cl.int(2n * ONE), Cl.int(3n * ONE)])).toBe(6n * ONE);
    expect(roInt("fp-mul", [Cl.int(-2n * ONE), Cl.int(3n * ONE)])).toBe(-6n * ONE);
    expect(roInt("fp-mul", [Cl.int(150_000_000n), Cl.int(150_000_000n)])).toBe(225_000_000n);
    expect(roInt("fp-mul", [Cl.int(0), Cl.int(123n)])).toBe(0n);
  });

  it("fp-div divides at 1e8 scale", () => {
    expect(roInt("fp-div", [Cl.int(6n * ONE), Cl.int(3n * ONE)])).toBe(2n * ONE);
    expect(roInt("fp-div", [Cl.int(ONE), Cl.int(3n * ONE)])).toBe(33_333_333n);
    expect(roInt("fp-div", [Cl.int(-6n * ONE), Cl.int(3n * ONE)])).toBe(-2n * ONE);
  });

  it("fp-sqrt is the integer square root at fp scale", () => {
    const sq = (x: bigint) =>
      BigInt(cvToJSON(simnet.callReadOnlyFn("bs-math", "fp-sqrt", [Cl.uint(x)], deployer).result).value);
    expect(sq(4n * ONE)).toBe(2n * ONE);
    expect(sq(ONE)).toBe(ONE);
    expect(sq(2n * ONE)).toBe(141_421_356n); // sqrt(2) = 1.41421356...
    expect(sq(1_917_808n)).toBe(13_848_494n); // sqrt(7/365)
    expect(sq(0n)).toBe(0n);
  });
});

describe("bs-math: fp-ln", () => {
  const cases: Array<[number, number]> = [
    [1, 0],
    [2, Math.LN2],
    [0.5, -Math.LN2],
    [1.5, Math.log(1.5)],
    [Math.E, 1],
    [10, Math.log(10)],
    [0.0001, Math.log(0.0001)],
    [104210 / 114631, Math.log(104210 / 114631)],
    [123456.789, Math.log(123456.789)],
  ];
  for (const [x, expected] of cases) {
    it(`ln(${x}) ~= ${expected.toFixed(8)}`, () => {
      const got = roInt("fp-ln", [Cl.int(fp(x))]);
      expect(Math.abs(Number(got) - expected * 1e8)).toBeLessThanOrEqual(300);
    });
  }
});

describe("bs-math: fp-exp", () => {
  const cases: Array<[number, number]> = [
    [0, 1],
    [1, Math.E],
    [-1, 1 / Math.E],
    [0.5, Math.exp(0.5)],
    [2.5, Math.exp(2.5)],
    [-0.0007671233, Math.exp(-0.0007671233)], // -r*T at reference inputs
    [10, Math.exp(10)],
  ];
  for (const [x, expected] of cases) {
    it(`exp(${x}) ~= ${expected.toFixed(8)}`, () => {
      const got = roInt("fp-exp", [Cl.int(fp(x))]);
      const tol = Math.max(expected * 1e8 * 1e-6, 60);
      expect(Math.abs(Number(got) - expected * 1e8)).toBeLessThanOrEqual(tol);
    });
  }

  it("underflows to 0 for very negative x", () => {
    expect(roInt("fp-exp", [Cl.int(fp(-20))])).toBe(0n);
    expect(roInt("fp-exp", [Cl.int(fp(-100))])).toBe(0n);
  });

  it("clamps huge x without overflow", () => {
    const got = roInt("fp-exp", [Cl.int(fp(100))]);
    expect(got).toBeGreaterThan(0n); // e^66 * 1e8, clamped
  });
});

describe("bs-math: fp-normcdf", () => {
  const xs = [-3, -1.96, -1.20299, -1, -0.5, -0.25, 0, 0.25, 0.5, 1, 1.96, 3];
  for (const x of xs) {
    it(`N(${x}) matches the TS mirror`, () => {
      const got = roInt("fp-normcdf", [Cl.int(fp(x))]);
      const mirror = normCDF(x) * 1e8;
      expect(Math.abs(Number(got) - mirror)).toBeLessThanOrEqual(100);
    });
  }

  it("matches textbook values within the A&S error bound", () => {
    const n0 = Number(roInt("fp-normcdf", [Cl.int(0n)]));
    expect(Math.abs(n0 - 50_000_000)).toBeLessThanOrEqual(300); // truncated coeffs: ~1.3e-6
    const n196 = Number(roInt("fp-normcdf", [Cl.int(fp(1.96))]));
    expect(Math.abs(n196 - 97_500_210)).toBeLessThanOrEqual(300);
  });

  it("saturates beyond |x| >= 6", () => {
    expect(roInt("fp-normcdf", [Cl.int(fp(7))])).toBe(ONE);
    expect(roInt("fp-normcdf", [Cl.int(fp(-7))])).toBe(0n);
  });
});

describe("bs-math: bs-call-price test vectors", () => {
  // [S, K, sigma, T, r, approxExpectedUsd]
  const T_WEEK = 1_917_808n; // 7 * 1e8 / 365
  const vectors: Array<{ s: bigint; k: bigint; sigma: bigint; t: bigint; r: bigint; approx: number | null }> = [
    { s: fp(100), k: fp(100), sigma: fp(0.5), t: fp(1), r: 0n, approx: 19.74 },
    { s: fp(100), k: fp(100), sigma: fp(0.2), t: fp(1), r: fp(0.05), approx: 10.45 },
    { s: 10_421_000_000_000n, k: 11_463_100_000_000n, sigma: fp(0.55), t: T_WEEK, r: fp(0.04), approx: 430 },
    { s: 10_421_000_000_000n, k: 10_942_050_000_000n, sigma: fp(0.55), t: T_WEEK, r: fp(0.04), approx: null },
  ];

  for (const [i, v] of vectors.entries()) {
    it(`vector ${i + 1}: parity with TS mirror (and ~$${v.approx ?? "mirror"} expected)`, () => {
      const got = bsCallPriceFp(v.s, v.k, v.sigma, v.t, v.r);
      const mirror = bsCall(
        Number(v.s) / 1e8,
        Number(v.k) / 1e8,
        Number(v.sigma) / 1e8,
        Number(v.t) / 1e8,
        Number(v.r) / 1e8
      );
      // Clarity <-> TS parity: 0.05% relative (or half a cent absolute)
      const tol = Math.max(mirror * 1e8 * 0.0005, 500_000);
      expect(Math.abs(Number(got) - mirror * 1e8)).toBeLessThanOrEqual(tol);
      // spec sanity band: 0.5% of the quoted approximation
      if (v.approx !== null) {
        expect(Math.abs(Number(got) / 1e8 - v.approx)).toBeLessThanOrEqual(v.approx * 0.005);
      }
    });
  }

  it("reference economics: ~0.41%/week, ~23-24% APY", () => {
    const got = Number(bsCallPriceFp(10_421_000_000_000n, 11_463_100_000_000n, fp(0.55), T_WEEK, fp(0.04)));
    const weekly = got / Number(10_421_000_000_000n);
    expect(weekly).toBeGreaterThan(0.004);
    expect(weekly).toBeLessThan(0.0042);
    const apy = Math.pow(1 + weekly, 52) - 1;
    expect(apy).toBeGreaterThan(0.23);
    expect(apy).toBeLessThan(0.24);
  });

  it("parity grid across moneyness / vol / tenor / rate", () => {
    const spots = [50_000, 104_210, 250_000];
    const mults = [1.02, 1.05, 1.1, 1.2];
    const ivs = [0.3, 0.55, 0.9];
    const tenors = [1 / 365, 7 / 365, 30 / 365];
    const rates = [0, 0.04];
    let checked = 0;
    for (const s of spots)
      for (const m of mults)
        for (const iv of ivs)
          for (const t of tenors)
            for (const r of rates) {
              const k = s * m;
              const mirror = bsCall(s, k, iv, t, r);
              const got = Number(bsCallPriceFp(fp(s), fp(k), fp(iv), fp(t), fp(r)));
              // 0.1% relative or 5 cents absolute, whichever is looser
              const tol = Math.max(mirror * 1e8 * 0.001, 5_000_000);
              expect(
                Math.abs(got - mirror * 1e8),
                `S=${s} K=${k} iv=${iv} T=${t} r=${r}: clar=${got / 1e8} ts=${mirror}`
              ).toBeLessThanOrEqual(tol);
              checked++;
            }
    expect(checked).toBe(216);
  });

  it("rejects out-of-domain inputs with ERR-DOMAIN (u1001)", () => {
    const bad = [
      [0n, fp(100), fp(0.5), fp(1), 0n],
      [fp(100), 0n, fp(0.5), fp(1), 0n],
      [fp(100), fp(100), 0n, fp(1), 0n],
      [fp(100), fp(100), fp(0.5), 0n, 0n],
      [fp(100), fp(100), fp(0.5), fp(1), fp(-0.01)],
    ];
    for (const [s, k, sigma, t, r] of bad) {
      const res = simnet.callReadOnlyFn(
        "bs-math",
        "bs-call-price",
        [Cl.int(s), Cl.int(k), Cl.int(sigma), Cl.int(t), Cl.int(r)],
        deployer
      );
      const j = cvToJSON(res.result);
      expect(j.success).toBe(false);
      expect(BigInt(j.value.value)).toBe(1001n);
    }
  });

  it("clamps tiny negative rounding to zero (deep OTM short tenor)", () => {
    const got = bsCallPriceFp(fp(100), fp(1_000_000), fp(0.1), 27_397n /* 1 day */, 0n);
    expect(got).toBe(0n);
  });
});
