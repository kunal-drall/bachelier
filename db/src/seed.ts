/**
 * Seed a devnet-shaped round into a clean database so the API and web app
 * have something to show: two depositors, one settled OTM round with two
 * taker positions, one active round, and snapshots.
 */
import url from "node:url";
import path from "node:path";
import { createDb } from "./index.js";
import { deposits, eventsRaw, indexerState, positions, prices, rounds, users, vaultSnapshots } from "./schema.js";

const ALICE = "ST1SJ3DTE5DN7X54YDH5D64R3BCB6A2AG2ZQ8YPD5";
const BOB = "ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG";
const CAROL = "ST2JHG361ZXG51QTKY2NQCVBPPRRE2KZB1HR05NNC";

const SPOT = 10_421_000_000_000n; // $104,210 * 1e8
const STRIKE = (SPOT * 11000n) / 10000n;
const PREMIUM_PER = 430_000_000n; // ~$430 in micro-USDC

export async function seed(databaseUrl = process.env.DATABASE_URL) {
  const { db, close } = createDb(databaseUrl);
  const now = Math.floor(Date.now() / 1000);
  const week = 7 * 24 * 3600;

  try {
    await db.transaction(async (tx) => {
      await tx.insert(users).values([
        { address: ALICE, firstSeenBlock: 100 },
        { address: BOB, firstSeenBlock: 102 },
        { address: CAROL, firstSeenBlock: 110 },
      ]).onConflictDoNothing();

      await tx.insert(deposits).values([
        {
          address: ALICE, amountSbtc: "500000000", shares: "500000000", roundId: 0,
          txId: "0xseed01", eventIndex: 0, blockHeight: 100, blockTime: now - 2 * week, canonical: true,
        },
        {
          address: BOB, amountSbtc: "300000000", shares: "300000000", roundId: 0,
          txId: "0xseed02", eventIndex: 0, blockHeight: 102, blockTime: now - 2 * week, canonical: true,
        },
      ]).onConflictDoNothing();

      await tx.insert(rounds).values([
        {
          roundId: 1, status: "settled", strike: STRIKE.toString(), iv: "55000000",
          spotOpen: SPOT.toString(), collateralAtOpen: "800000000",
          openedAt: now - 2 * week, expiry: now - week,
          contractsWritten: "5", premiumCollectedUsdc: (PREMIUM_PER * 5n).toString(),
          settlementPrice: (SPOT - 100_000_000_000n).toString(), payoutPerContract: "0", sbtcPaidOut: "0",
          openedTx: "0xseed10", settledTx: "0xseed11",
        },
        {
          roundId: 2, status: "active", strike: STRIKE.toString(), iv: "55000000",
          spotOpen: SPOT.toString(), collateralAtOpen: "800000000",
          openedAt: now - 2 * 24 * 3600, expiry: now - 2 * 24 * 3600 + week,
          contractsWritten: "2", premiumCollectedUsdc: (PREMIUM_PER * 2n).toString(),
          openedTx: "0xseed20",
        },
      ]).onConflictDoNothing();

      await tx.insert(positions).values([
        { roundId: 1, buyer: CAROL, contracts: "3", premiumPaidUsdc: (PREMIUM_PER * 3n).toString(), strike: STRIKE.toString(), settled: true, payoutSbtc: "0" },
        { roundId: 1, buyer: BOB, contracts: "2", premiumPaidUsdc: (PREMIUM_PER * 2n).toString(), strike: STRIKE.toString(), settled: true, payoutSbtc: "0" },
        { roundId: 2, buyer: CAROL, contracts: "2", premiumPaidUsdc: (PREMIUM_PER * 2n).toString(), strike: STRIKE.toString(), settled: false },
      ]).onConflictDoNothing();

      const snaps = [];
      for (let i = 0; i <= 14; i++) {
        const ts = now - (14 - i) * 24 * 3600;
        const cumulative = i < 7 ? 0n : PREMIUM_PER * 5n + (i >= 12 ? PREMIUM_PER * 2n : 0n);
        snaps.push({
          blockHeight: 100 + i * 10,
          ts,
          tvlSbtc: "800000000",
          reservedPayoutSbtc: "0",
          totalShares: "800000000",
          sharePrice: "100000000",
          premiumPoolUsdc: cumulative.toString(),
          cumulativePremiumUsdc: cumulative.toString(),
        });
      }
      await tx.insert(vaultSnapshots).values(snaps);

      await tx.insert(prices).values({ ts: now, btcUsd: SPOT.toString(), source: "seed" });
      await tx
        .insert(indexerState)
        .values({ id: 1, lastBlockHeight: 240 })
        .onConflictDoUpdate({ target: indexerState.id, set: { lastBlockHeight: 240 } });

      await tx.insert(eventsRaw).values({
        txId: "0xseed10", eventIndex: 0, txIndex: 0, kind: "round-started",
        payload: { e: "round-started", round: "1" }, blockHeight: 110, blockTime: now - 2 * week, canonical: true,
      }).onConflictDoNothing();
    });
    console.log("seeded devnet-shaped data");
  } finally {
    await close();
  }
}

if (process.argv[1] && url.fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  seed().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
