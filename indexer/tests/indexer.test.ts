/**
 * Indexer acceptance gates (spec section 4), against in-memory Postgres:
 *  - replay a full round into correct rows
 *  - duplicate webhook delivery is a no-op
 *  - rollback reverses and re-apply restores
 *  - restart resumes from the stored height
 */
import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { Cl, serializeCV, type ClarityValue } from "@stacks/transactions";
import { schema, deposits, withdrawals, positions, rounds, vaultSnapshots, eventsRaw, premiumClaims } from "@bachelier/db";
import { buildServer } from "../src/server.js";
import { lastIndexedBlock } from "../src/projector.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const VAULT = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.vault";
const SECRET = "test-secret";

const ALICE = "ST1SJ3DTE5DN7X54YDH5D64R3BCB6A2AG2ZQ8YPD5";
const BOB = "ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG";
const CAROL = "ST2JHG361ZXG51QTKY2NQCVBPPRRE2KZB1HR05NNC";

const SPOT = 10_421_000_000_000n;
const STRIKE = 11_463_100_000_000n;
const S_EXP = 14_328_875_000_000n;

let db: any;
let app: ReturnType<typeof buildServer>;

function hexOf(cv: ClarityValue): string {
  const s = serializeCV(cv);
  return typeof s === "string" ? s : Buffer.from(s).toString("hex");
}

function printEv(tuple: Record<string, ClarityValue>, txId: string, txIndex: number, eventIndex = 0) {
  return {
    txId,
    txIndex,
    eventIndex,
    data: {
      type: "SmartContractEvent",
      position: { index: eventIndex },
      data: { contract_identifier: VAULT, topic: "print", raw_value: hexOf(Cl.tuple(tuple)) },
    },
  };
}

function chainhookBlock(height: number, timestamp: number, events: ReturnType<typeof printEv>[]) {
  const byTx = new Map<string, ReturnType<typeof printEv>[]>();
  for (const ev of events) {
    const arr = byTx.get(ev.txId) ?? [];
    arr.push(ev);
    byTx.set(ev.txId, arr);
  }
  return {
    block_identifier: { index: height, hash: `0xblock${height}` },
    timestamp,
    transactions: [...byTx.entries()].map(([txId, evs]) => ({
      transaction_identifier: { hash: txId },
      metadata: {
        success: true,
        position: { index: evs[0].txIndex },
        receipt: { events: evs.map((e) => e.data) },
      },
    })),
  };
}

const T0 = 1_780_000_000;
const EXPIRY = T0 + 604_800;

function fullRoundBlocks() {
  return [
    chainhookBlock(110, T0, [
      printEv({ e: Cl.stringAscii("deposit"), user: Cl.principal(ALICE), amount: Cl.uint(500_000_000n), shares: Cl.uint(500_000_000n), round: Cl.uint(0n) }, "0xa1", 0),
      printEv({ e: Cl.stringAscii("deposit"), user: Cl.principal(BOB), amount: Cl.uint(300_000_000n), shares: Cl.uint(300_000_000n), round: Cl.uint(0n) }, "0xa2", 1),
    ]),
    chainhookBlock(111, T0 + 600, [
      printEv({ e: Cl.stringAscii("round-started"), round: Cl.uint(1n), strike: Cl.int(STRIKE), iv: Cl.uint(55_000_000n), expiry: Cl.uint(EXPIRY), spot: Cl.int(SPOT), collateral: Cl.uint(800_000_000n) }, "0xb1", 0),
    ]),
    chainhookBlock(112, T0 + 1200, [
      printEv({ e: Cl.stringAscii("call-bought"), round: Cl.uint(1n), buyer: Cl.principal(CAROL), contracts: Cl.uint(2n), premium: Cl.uint(860_000_000n), strike: Cl.int(STRIKE), spot: Cl.int(SPOT), "t-fp": Cl.uint(1_915_905n) }, "0xc1", 0),
    ]),
    chainhookBlock(113, EXPIRY + 600, [
      printEv({ e: Cl.stringAscii("round-settled"), round: Cl.uint(1n), "settlement-price": Cl.int(S_EXP), "payout-per-contract": Cl.uint(20_000_000n), "sbtc-paid-out": Cl.uint(40_000_000n), "premium-retained": Cl.uint(860_000_000n) }, "0xd1", 0),
    ]),
    chainhookBlock(114, EXPIRY + 1200, [
      printEv({ e: Cl.stringAscii("exercised"), round: Cl.uint(1n), buyer: Cl.principal(CAROL), "payout-sbtc": Cl.uint(40_000_000n) }, "0xe1", 0),
      printEv({ e: Cl.stringAscii("claim"), user: Cl.principal(ALICE), usdc: Cl.uint(537_500_000n) }, "0xf1", 1),
      printEv({ e: Cl.stringAscii("withdraw"), user: Cl.principal(ALICE), shares: Cl.uint(100_000_000n), "sbtc-out": Cl.uint(95_000_000n), round: Cl.uint(1n) }, "0xg1", 2),
    ]),
  ];
}

async function post(payload: unknown) {
  return app.inject({
    method: "POST",
    url: "/chainhook/events",
    headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
    payload: JSON.stringify(payload),
  });
}

async function latestSnapshot() {
  const rows = await db.select().from(vaultSnapshots);
  return rows[rows.length - 1];
}

beforeAll(async () => {
  const client = new PGlite();
  const migrationsDir = path.join(here, "../../db/migrations");
  for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
    const sqlText = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    for (const stmt of sqlText.split("--> statement-breakpoint")) {
      if (stmt.trim()) await client.exec(stmt);
    }
  }
  db = drizzle(client, { schema });
  app = buildServer({ db, vaultContract: VAULT, chainhookSecret: SECRET });
});

describe("indexer", () => {
  it("rejects unauthorized webhooks", async () => {
    const res = await app.inject({ method: "POST", url: "/chainhook/events", payload: { apply: [] } });
    expect(res.statusCode).toBe(401);
  });

  it("replays a full devnet round into correct rows", async () => {
    const res = await post({ apply: fullRoundBlocks() });
    expect(res.statusCode).toBe(200);
    expect(res.json().applied).toBe(8);

    const deps = await db.select().from(deposits);
    expect(deps).toHaveLength(2);
    expect(deps.map((d: any) => d.address).sort()).toEqual([ALICE, BOB].sort());

    const [round] = await db.select().from(rounds);
    expect(round.roundId).toBe(1);
    expect(round.status).toBe("settled");
    expect(round.strike).toBe(STRIKE.toString());
    expect(round.contractsWritten).toBe("2");
    expect(round.premiumCollectedUsdc).toBe("860000000");
    expect(round.settlementPrice).toBe(S_EXP.toString());
    expect(round.sbtcPaidOut).toBe("40000000");
    expect(round.collateralAtOpen).toBe("800000000");

    const [pos] = await db.select().from(positions);
    expect(pos.buyer).toBe(CAROL);
    expect(pos.contracts).toBe("2");
    expect(pos.settled).toBe(true);
    expect(pos.payoutSbtc).toBe("40000000");

    const claims = await db.select().from(premiumClaims);
    expect(claims).toHaveLength(1);
    const wds = await db.select().from(withdrawals);
    expect(wds).toHaveLength(1);

    const snap = await latestSnapshot();
    expect(snap.tvlSbtc).toBe((800_000_000n - 40_000_000n - 95_000_000n).toString());
    expect(snap.totalShares).toBe("700000000");
    expect(snap.reservedPayoutSbtc).toBe("0");
    expect(snap.premiumPoolUsdc).toBe((860_000_000n - 537_500_000n).toString());
    expect(snap.cumulativePremiumUsdc).toBe("860000000");

    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.json()).toEqual({ ok: true, lastIndexedBlock: 114 });
  });

  it("treats a duplicate webhook delivery as a no-op", async () => {
    const before = {
      raw: (await db.select().from(eventsRaw)).length,
      deps: (await db.select().from(deposits)).length,
      snaps: (await db.select().from(vaultSnapshots)).length,
      round: (await db.select().from(rounds))[0],
    };
    const res = await post({ apply: fullRoundBlocks() });
    expect(res.json().applied).toBe(0);

    expect((await db.select().from(eventsRaw)).length).toBe(before.raw);
    expect((await db.select().from(deposits)).length).toBe(before.deps);
    expect((await db.select().from(vaultSnapshots)).length).toBe(before.snaps);
    const [round] = await db.select().from(rounds);
    expect(round.contractsWritten).toBe(before.round.contractsWritten); // no double count
  });

  it("rollback reverses the tip block; re-apply restores it", async () => {
    const blocks = fullRoundBlocks();
    const tip = blocks[4];

    const res = await post({ apply: [], rollback: [tip] });
    expect(res.statusCode).toBe(200);
    expect(res.json().rolledBack).toBe(1);

    // projections rebuilt to post-settlement state (block 113)
    const snap = await latestSnapshot();
    expect(snap.tvlSbtc).toBe("760000000");
    expect(snap.totalShares).toBe("800000000");
    expect(snap.reservedPayoutSbtc).toBe("40000000");
    expect(snap.premiumPoolUsdc).toBe("860000000");
    expect((await db.select().from(withdrawals)).length).toBe(0);
    expect((await db.select().from(premiumClaims)).length).toBe(0);
    const [pos] = await db.select().from(positions);
    expect(pos.payoutSbtc).toBeNull();

    // canonical re-apply (chainhook re-sends the canonical fork)
    const res2 = await post({ apply: [tip] });
    expect(res2.json().applied).toBe(3);
    const snap2 = await latestSnapshot();
    expect(snap2.tvlSbtc).toBe("665000000");
    expect(snap2.totalShares).toBe("700000000");
    expect(snap2.reservedPayoutSbtc).toBe("0");
  });

  it("a restarted server resumes from the stored height", async () => {
    const app2 = buildServer({ db, vaultContract: VAULT, chainhookSecret: SECRET });
    const health = await app2.inject({ method: "GET", url: "/health" });
    expect(health.json().lastIndexedBlock).toBe(114);
    expect(await lastIndexedBlock(db)).toBe(114);
  });
});
