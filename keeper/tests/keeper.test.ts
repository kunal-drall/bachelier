/**
 * Keeper policy + loop tests with a mocked chain: full-cycle automation,
 * stale-oracle recovery, and retry/backoff safety (spec section 7).
 */
import { describe, expect, it, vi } from "vitest";
import { decide } from "../src/keeper.js";
import { createKeeperLoop } from "../src/keeper.js";
import type { KeeperChain, OracleState, RoundState } from "../src/chain.js";

const freshOracle = (pt: bigint): OracleState => ({ price: 10_421_000_000_000n, publishTime: pt, fresh: true });
const staleOracle: OracleState = { price: 0n, publishTime: 0n, fresh: false };

describe("decide: round-lifecycle policy", () => {
  const active = (expiry: bigint): RoundState => ({ status: "active", roundId: 1n, expiry, contractsWritten: 2n });

  it("does nothing while a round is active and unexpired", () => {
    const a = decide({ round: active(1000n), oracle: freshOracle(900n), now: 500n, startWanted: true, priceRelay: false });
    expect(a).toEqual({ type: "none", reason: "round active, not yet expired" });
  });

  it("settles once expired with a post-expiry price", () => {
    const a = decide({ round: active(1000n), oracle: freshOracle(1001n), now: 1100n, startWanted: false, priceRelay: false });
    expect(a.type).toBe("settle");
  });

  it("refuses to settle with a pre-expiry price; relays when allowed", () => {
    const noRelay = decide({ round: active(1000n), oracle: freshOracle(900n), now: 1100n, startWanted: false, priceRelay: false });
    expect(noRelay.type).toBe("none");
    const relay = decide({ round: active(1000n), oracle: freshOracle(900n), now: 1100n, startWanted: false, priceRelay: true });
    expect(relay).toEqual({ type: "relay-price", then: "settle" });
  });

  it("starts only when the schedule wants it and the oracle is fresh", () => {
    const settled: RoundState = { status: "settled", roundId: 1n, expiry: 1000n, contractsWritten: 2n };
    expect(decide({ round: settled, oracle: freshOracle(2000n), now: 2100n, startWanted: false, priceRelay: false }).type).toBe("none");
    expect(decide({ round: settled, oracle: freshOracle(2000n), now: 2100n, startWanted: true, priceRelay: false }).type).toBe("start");
    expect(decide({ round: settled, oracle: staleOracle, now: 2100n, startWanted: true, priceRelay: false }).type).toBe("none");
    expect(decide({ round: settled, oracle: staleOracle, now: 2100n, startWanted: true, priceRelay: true })).toEqual({ type: "relay-price", then: "start" });
  });
});

function mockChain(): KeeperChain & {
  state: { round: RoundState; oracle: OracleState; now: bigint };
  calls: string[];
} {
  const state = {
    round: { status: "none", roundId: 0n, expiry: 0n, contractsWritten: 0n } as RoundState,
    oracle: staleOracle as OracleState,
    now: 1000n,
  };
  const calls: string[] = [];
  return {
    state,
    calls,
    address: "ST_KEEPER",
    now: async () => state.now,
    roundState: async () => state.round,
    oracleState: async () => state.oracle,
    settleGrace: async () => 3600n,
    relayPrice: async (p) => {
      calls.push("relay");
      state.oracle = { price: p, publishTime: state.now, fresh: true };
      return "0xrelay";
    },
    startRound: async () => {
      calls.push("start");
      state.round = { status: "active", roundId: state.round.roundId + 1n, expiry: state.now + 604_800n, contractsWritten: 0n };
      return "0xstart";
    },
    settleRound: async () => {
      calls.push("settle");
      state.round = { ...state.round, status: "settled" };
      return "0xsettle";
    },
  };
}

describe("keeper loop", () => {
  it("drives a full cycle: relay -> start -> (expiry) -> relay -> settle -> start", async () => {
    const chain = mockChain();
    const loop = createKeeperLoop({
      chain,
      otmBps: 1000,
      iv1e8: 55_000_000n,
      priceRelay: true,
      priceSourceUrl: "",
      maxRetries: 2,
      log: () => {},
    });

    loop.requestStart();
    await loop.tick(); // stale oracle -> relay
    expect(chain.calls).toEqual(["relay"]);
    await loop.tick(); // fresh now -> start
    expect(chain.calls).toEqual(["relay", "start"]);
    expect(chain.state.round.status).toBe("active");

    // advance past expiry; oracle publish-time is pre-expiry -> relay then settle
    chain.state.now = chain.state.round.expiry + 100n;
    await loop.tick();
    expect(chain.calls).toEqual(["relay", "start", "relay"]);
    await loop.tick();
    expect(chain.calls).toEqual(["relay", "start", "relay", "settle"]);
    expect(chain.state.round.status).toBe("settled");

    // settle re-arms startWanted: next tick opens the following round
    chain.state.now += 100n;
    await loop.tick();
    expect(chain.calls[chain.calls.length - 1]).toBe("start");
    expect(chain.state.round.roundId).toBe(2n);
  });

  it("recovers from an injected stale-oracle failure with retries", async () => {
    vi.useFakeTimers();
    const chain = mockChain();
    chain.state.oracle = freshOracle(2000n);
    chain.state.round = { status: "active", roundId: 1n, expiry: 1500n, contractsWritten: 1n };
    chain.state.now = 2000n;

    let failures = 1;
    const realSettle = chain.settleRound;
    chain.settleRound = async () => {
      if (failures-- > 0) throw new Error("stale price (u109)");
      return realSettle();
    };

    const loop = createKeeperLoop({
      chain, otmBps: 1000, iv1e8: 55_000_000n, priceRelay: false, priceSourceUrl: "", maxRetries: 3,
      log: () => {},
    });
    const tick = loop.tick();
    await vi.advanceTimersByTimeAsync(10_000);
    await tick;
    expect(chain.calls).toContain("settle");
    expect(loop.status.lastError).toBeNull();
    expect(chain.state.round.status).toBe("settled");
    vi.useRealTimers();
  });

  it("records failures and keeps the loop alive when the chain is down", async () => {
    vi.useFakeTimers();
    const chain = mockChain();
    chain.roundState = async () => {
      throw new Error("ECONNREFUSED");
    };
    const loop = createKeeperLoop({
      chain, otmBps: 1000, iv1e8: 55_000_000n, priceRelay: false, priceSourceUrl: "", maxRetries: 1,
      log: () => {},
    });
    const t = loop.tick();
    await vi.advanceTimersByTimeAsync(5_000);
    await t;
    expect(loop.status.lastError).toContain("ECONNREFUSED");
    expect(loop.status.consecutiveFailures).toBe(1);
    vi.useRealTimers();
  });
});
