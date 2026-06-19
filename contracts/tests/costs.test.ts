/**
 * Execution-cost gates. Clarity's per-block runtime budget is 5e9 units;
 * a transaction must stay well inside it. bs-call-price is exercised here
 * through buy-call (oracle read + pricing + token transfer + index update),
 * which is the protocol's heaviest path.
 *
 * Run with cost tracking: `vitest run -- --costs` (the default `pnpm test`).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";
import { deployer, alice, carol, ONE, ok, bootstrap } from "./helpers";

const BLOCK_RUNTIME_LIMIT = 5_000_000_000;

function runtimeOf(res: any): number | null {
  const c = res.costs;
  if (!c) return null;
  return Number(c.total?.runtime ?? c.runtime ?? NaN);
}

beforeAll(() => {
  bootstrap();
  ok(
    simnet.callPublicFn(
      "vault",
      "set-config",
      [Cl.uint(100_000n), Cl.uint(100n), Cl.uint(5000n), Cl.uint(10_000_000n), Cl.uint(300_000_000n), Cl.uint(604_800n), Cl.uint(1200n), Cl.int(4_000_000n)],
      deployer
    )
  );
});

describe("execution costs", () => {
  it("deposit, start-round, and buy-call all fit comfortably in budget", () => {
    const dep = simnet.callPublicFn("vault", "deposit", [Cl.uint(5n * ONE), Cl.contractPrincipal(deployer, "sbtc-token")], alice);
    ok(dep);
    const start = simnet.callPublicFn("vault", "start-round", [Cl.uint(1000n), Cl.uint(55_000_000n)], deployer);
    ok(start);
    const buy = simnet.callPublicFn("vault", "buy-call", [Cl.uint(2n), Cl.contractPrincipal(deployer, "usdc-token")], carol);
    ok(buy);

    const rDep = runtimeOf(dep);
    const rStart = runtimeOf(start);
    const rBuy = runtimeOf(buy);

    if (rBuy === null) {
      // cost tracking not enabled for this run; the dedicated `pnpm test`
      // script enables it. Fail loudly so the gate cannot silently vanish.
      expect.fail("cost tracking disabled - run vitest with `-- --costs`");
    }

    console.log(`runtime costs: deposit=${rDep} start-round=${rStart} buy-call=${rBuy} (block limit ${BLOCK_RUNTIME_LIMIT})`);

    // buy-call (the bs-math hot path) must stay under 5% of a block
    expect(rBuy).toBeLessThan(BLOCK_RUNTIME_LIMIT * 0.05);
    expect(rStart!).toBeLessThan(BLOCK_RUNTIME_LIMIT * 0.05);
    expect(rDep!).toBeLessThan(BLOCK_RUNTIME_LIMIT * 0.05);
  });
});
