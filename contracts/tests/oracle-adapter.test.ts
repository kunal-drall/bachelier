import { describe, expect, it } from "vitest";
import { Cl, cvToJSON } from "@stacks/transactions";
import { deployer, alice, nowRo, err, ok } from "./helpers";

function getBtcPrice() {
  return simnet.callReadOnlyFn("oracle-adapter", "get-btc-price", [], deployer);
}

describe("oracle-adapter", () => {
  it("returns a fresh, positive price", () => {
    const t = nowRo();
    ok(simnet.callPublicFn("pyth-mock", "set-price", [Cl.int(10_421_000_000_000n), Cl.uint(t)], deployer));
    const res = getBtcPrice();
    const j = cvToJSON(res.result);
    expect(j.success).toBe(true);
    expect(BigInt(j.value.value.price.value)).toBe(10_421_000_000_000n);
  });

  it("rejects a stale price (u109) once max-age has elapsed", () => {
    const t = nowRo();
    ok(simnet.callPublicFn("pyth-mock", "set-price", [Cl.int(10_421_000_000_000n), Cl.uint(t)], deployer));
    // default max-age is 3600s = 6 blocks at 600s/block; mine past it
    simnet.mineEmptyBlocks(8);
    const res = getBtcPrice();
    const j = cvToJSON(res.result);
    expect(j.success).toBe(false);
    expect(BigInt(j.value.value)).toBe(109n);
  });

  it("rejects non-positive prices (u110)", () => {
    const t = nowRo();
    ok(simnet.callPublicFn("pyth-mock", "set-price", [Cl.int(0n), Cl.uint(t + 600n)], deployer));
    const res = getBtcPrice();
    const j = cvToJSON(res.result);
    expect(j.success).toBe(false);
    expect(BigInt(j.value.value)).toBe(110n);

    ok(simnet.callPublicFn("pyth-mock", "set-price", [Cl.int(-1n), Cl.uint(t + 1200n)], deployer));
    const res2 = getBtcPrice();
    const j2 = cvToJSON(res2.result);
    expect(j2.success).toBe(false);
    expect(BigInt(j2.value.value)).toBe(110n);
  });

  it("set-max-age is owner-only (u108)", () => {
    err(simnet.callPublicFn("oracle-adapter", "set-max-age", [Cl.uint(60n)], alice), 108);
    ok(simnet.callPublicFn("oracle-adapter", "set-max-age", [Cl.uint(7200n)], deployer));
    const ma = simnet.callReadOnlyFn("oracle-adapter", "get-max-age", [], deployer);
    expect(BigInt(cvToJSON(ma.result).value)).toBe(7200n);
  });
});
