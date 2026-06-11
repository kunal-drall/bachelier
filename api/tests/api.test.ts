/**
 * API acceptance (spec section 6): zod-valid payloads on empty and seeded
 * DBs, /quote reference economics (~$430 premium, ~23-24% APY) and parity
 * with the contract's preview-quote (stubbed with the verified on-chain
 * fixture from contracts/tests/bs-math.test.ts).
 */
import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { schema, deposits, positions, prices, rounds, vaultSnapshots, indexerState } from "@bachelier/db";
import { buildApi } from "../src/routes.js";
import type { ChainReader } from "../src/chain.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const ALICE = "ST1SJ3DTE5DN7X54YDH5D64R3BCB6A2AG2ZQ8YPD5";
const CAROL = "ST2JHG361ZXG51QTKY2NQCVBPPRRE2KZB1HR05NNC";
const SPOT = 10_421_000_000_000n;
const STRIKE = 11_463_100_000_000n;

// verified on-chain output for the reference vector (bs-math.test.ts)
const ONCHAIN_PREMIUM_FP = 42_848_661_381n; // USD 1e8
const chainStub: ChainReader = {
  getUser: async () => ({
    shares: 500_000_000n,
    valueSbtc: 500_000_000n,
    claimablePremiumUsdc: 1_000_000n,
    queuedShares: 0n,
  }),
  previewQuote: async (otmBps) =>
    otmBps === 1000
      ? { spot: SPOT, strike: STRIKE, premiumPerContractUsdc: ONCHAIN_PREMIUM_FP / 100n }
      : null,
  readPrice: async () => ({ btcUsd: SPOT, publishTime: 1_780_000_000 }),
};

const nullChain: ChainReader = {
  getUser: async () => null,
  previewQuote: async () => null,
  readPrice: async () => null,
};

async function makeDb() {
  const client = new PGlite();
  const migrationsDir = path.join(here, "../../db/migrations");
  for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
    const sqlText = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    for (const stmt of sqlText.split("--> statement-breakpoint")) if (stmt.trim()) await client.exec(stmt);
  }
  return drizzle(client, { schema });
}

function apiOpts(db: any, chain: ChainReader) {
  return {
    db,
    chain,
    stacksApiUrl: "http://stacks.invalid",
    riskFreeRate: 0.04,
    roundLenSecs: 604_800,
    defaultIv: 0.55,
    defaultOtmBps: 1000,
  };
}

describe("api: empty database", () => {
  let app: Awaited<ReturnType<typeof buildApi>>;
  beforeAll(async () => {
    app = await buildApi(apiOpts(await makeDb(), nullChain));
  });

  it("GET /health reports ok with no indexed block", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, lastIndexedBlock: null });
  });

  it("GET /vault returns a zod-valid zero state", async () => {
    const res = await app.inject({ method: "GET", url: "/vault" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tvlSbtc).toBe("0");
    expect(body.currentRound).toBeNull();
    expect(body.btcUsd).toBeNull();
  });

  it("GET /rounds returns an empty page", async () => {
    const res = await app.inject({ method: "GET", url: "/rounds" });
    expect(res.json()).toEqual({ rounds: [], nextCursor: null });
  });

  it("GET /quote without any price source is 503", async () => {
    const res = await app.inject({ method: "GET", url: "/quote" });
    expect(res.statusCode).toBe(503);
  });

  it("GET /positions/:address falls back to indexed flows", async () => {
    const res = await app.inject({ method: "GET", url: `/positions/${ALICE}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().shares).toBe("0");
  });
});

describe("api: seeded database", () => {
  let app: Awaited<ReturnType<typeof buildApi>>;

  beforeAll(async () => {
    const db = await makeDb();
    const now = Math.floor(Date.now() / 1000);
    await db.insert(deposits).values({
      address: ALICE, amountSbtc: "500000000", shares: "500000000", roundId: 0,
      txId: "0xa1", eventIndex: 0, blockHeight: 100, blockTime: now - 14 * 86400, canonical: true,
    });
    await db.insert(rounds).values([
      {
        roundId: 1, status: "settled", strike: STRIKE.toString(), iv: "55000000",
        spotOpen: SPOT.toString(), collateralAtOpen: "800000000",
        openedAt: now - 14 * 86400, expiry: now - 7 * 86400,
        contractsWritten: "5", premiumCollectedUsdc: "2150000000",
        settlementPrice: (SPOT - 50_000_000_000n).toString(), payoutPerContract: "0", sbtcPaidOut: "0",
        openedTx: "0xb1", settledTx: "0xb2",
      },
      {
        roundId: 2, status: "active", strike: STRIKE.toString(), iv: "55000000",
        spotOpen: SPOT.toString(), collateralAtOpen: "800000000",
        openedAt: now - 86400, expiry: now + 6 * 86400,
        contractsWritten: "2", premiumCollectedUsdc: "860000000", openedTx: "0xc1",
      },
    ]);
    await db.insert(positions).values([
      { roundId: 1, buyer: CAROL, contracts: "5", premiumPaidUsdc: "2150000000", strike: STRIKE.toString(), settled: true, payoutSbtc: "0" },
      { roundId: 2, buyer: CAROL, contracts: "2", premiumPaidUsdc: "860000000", strike: STRIKE.toString(), settled: false },
    ]);
    for (let i = 0; i < 10; i++) {
      await db.insert(vaultSnapshots).values({
        blockHeight: 100 + i, ts: now - (10 - i) * 86400,
        tvlSbtc: "800000000", reservedPayoutSbtc: "0", totalShares: "800000000",
        sharePrice: "100000000", premiumPoolUsdc: "2150000000", cumulativePremiumUsdc: "2150000000",
      });
    }
    await db.insert(prices).values({ ts: now, btcUsd: SPOT.toString(), source: "round-started" });
    await db.insert(indexerState).values({ id: 1, lastBlockHeight: 240 });
    app = await buildApi(apiOpts(db, chainStub));
  });

  it("GET /vault aggregates state, APYs, and capacity", async () => {
    const res = await app.inject({ method: "GET", url: "/vault" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tvlSbtc).toBe("800000000");
    expect(body.currentRound.roundId).toBe(2);
    expect(body.currentRound.status).toBe("active");
    expect(body.btcUsd).toBeCloseTo(104210, 0);
    // realized: one settled round, $2150 premium on 8 BTC at $104,210
    expect(body.trailingApy).toBeGreaterThan(0.1);
    expect(body.trailingApy).toBeLessThan(0.2);
    expect(body.forwardApy).toBeGreaterThan(0.2);
    // 8 sBTC collateral, 2 written -> 6 contracts capacity
    expect(body.capacitySbtc).toBe("600000000");
    expect(res.headers["cache-control"]).toContain("max-age=5");
  });

  it("GET /vault/history returns a bucketed series", async () => {
    const res = await app.inject({ method: "GET", url: "/vault/history?range=30d&interval=1d" });
    const body = res.json();
    expect(body.points.length).toBeGreaterThanOrEqual(9);
    expect(body.points[0].tvlSbtc).toBe("800000000");
  });

  it("GET /rounds pages with a cursor; GET /rounds/:id includes positions", async () => {
    const res = await app.inject({ method: "GET", url: "/rounds?limit=1" });
    const body = res.json();
    expect(body.rounds[0].roundId).toBe(2);
    expect(body.nextCursor).toBe(2);

    const res2 = await app.inject({ method: "GET", url: `/rounds?limit=1&cursor=${body.nextCursor}` });
    expect(res2.json().rounds[0].roundId).toBe(1);

    const detail = await app.inject({ method: "GET", url: "/rounds/1" });
    const d = detail.json();
    expect(d.buyers).toBe(1);
    expect(d.positions[0].buyer).toBe(CAROL);

    const missing = await app.inject({ method: "GET", url: "/rounds/99" });
    expect(missing.statusCode).toBe(404);
  });

  it("GET /positions/:address merges live chain state with indexed history", async () => {
    const res = await app.inject({ method: "GET", url: `/positions/${ALICE}` });
    const body = res.json();
    expect(body.shares).toBe("500000000"); // from chain stub
    expect(body.claimablePremiumUsdc).toBe("1000000");
    expect(body.deposits).toHaveLength(1);

    const taker = await app.inject({ method: "GET", url: `/positions/${CAROL}` });
    expect(taker.json().takerPositions).toHaveLength(2);
  });

  it("GET /quote returns the reference economics and on-chain parity", async () => {
    const res = await app.inject({ method: "GET", url: "/quote?notional=1&otmBps=1000&iv=0.55" });
    expect(res.statusCode).toBe(200);
    const q = res.json();
    // ~$430 premium per 1-sBTC contract at the reference inputs
    expect(q.premiumPerSbtcUsdc).toBeGreaterThan(420);
    expect(q.premiumPerSbtcUsdc).toBeLessThan(440);
    expect(Math.abs(q.premiumPerSbtcUsdc - 430)).toBeLessThanOrEqual(430 * 0.005);
    // ~23-24% APY weekly compounded
    expect(q.apy).toBeGreaterThan(0.23);
    expect(q.apy).toBeLessThan(0.24);
    expect(q.strike).toBeCloseTo(104210 * 1.1, 0);
    // parity with the contract's preview-quote within tolerance
    expect(q.onChain).not.toBeNull();
    expect(q.onChain.agreesWithinPct).toBeLessThan(0.5);
  });

  it("GET /quote validates inputs", async () => {
    const res = await app.inject({ method: "GET", url: "/quote?iv=-1" });
    expect(res.statusCode).toBe(400);
  });

  it("GET /price prefers the live oracle read", async () => {
    const res = await app.inject({ method: "GET", url: "/price" });
    const body = res.json();
    expect(body.btcUsd).toBeCloseTo(104210, 0);
    expect(body.source).toBe("pyth");
  });

  it("GET /tx/:txid rejects malformed ids", async () => {
    const res = await app.inject({ method: "GET", url: "/tx/nothex" });
    expect(res.statusCode).toBe(400);
  });
});
