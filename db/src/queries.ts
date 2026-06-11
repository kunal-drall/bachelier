/**
 * Read helpers shared by the API. Realized trailing APY: per settled round,
 * yield_i = premium_collected / (collateral_at_open_btc * spot_open); the
 * trailing APY compounds the last N round yields to a 52-week year.
 */
import { desc, eq, sql } from "drizzle-orm";
import type { Db } from "./index.js";
import { rounds, vaultSnapshots } from "./schema.js";

export async function trailingApy(db: Db, lastN = 8): Promise<number | null> {
  const settled = await db
    .select()
    .from(rounds)
    .where(eq(rounds.status, "settled"))
    .orderBy(desc(rounds.roundId))
    .limit(lastN);
  const usable = settled.filter(
    (r) => r.spotOpen && r.collateralAtOpen && Number(r.collateralAtOpen) > 0 && Number(r.spotOpen) > 0
  );
  if (usable.length === 0) return null;
  let growth = 1;
  for (const r of usable) {
    const collateralUsd = (Number(r.collateralAtOpen) / 1e8) * (Number(r.spotOpen) / 1e8);
    const premiumUsd = Number(r.premiumCollectedUsdc) / 1e6;
    if (collateralUsd > 0) growth *= 1 + premiumUsd / collateralUsd;
  }
  return Math.pow(growth, 52 / usable.length) - 1;
}

export async function latestSnapshot(db: Db) {
  const [snap] = await db.select().from(vaultSnapshots).orderBy(desc(vaultSnapshots.id)).limit(1);
  return snap ?? null;
}

/** snapshot series bucketed by interval seconds over a trailing range */
export async function snapshotSeries(db: Db, rangeSecs: number, intervalSecs: number) {
  const cutoff = Math.floor(Date.now() / 1000) - rangeSecs;
  // interval must be inlined so SELECT/GROUP BY are the identical expression;
  // it is a server-side constant (never user input), coerced to int here.
  const bucket = sql.raw(`(ts / ${Math.max(1, Math.floor(intervalSecs))}) * ${Math.max(1, Math.floor(intervalSecs))}`);
  return db
    .select({
      ts: sql<number>`${bucket}`.mapWith(Number),
      blockHeight: sql<number>`max(${vaultSnapshots.blockHeight})`.mapWith(Number),
      tvlSbtc: sql<string>`(array_agg(${vaultSnapshots.tvlSbtc} order by ${vaultSnapshots.id} desc))[1]`,
      totalShares: sql<string>`(array_agg(${vaultSnapshots.totalShares} order by ${vaultSnapshots.id} desc))[1]`,
      sharePrice: sql<string>`(array_agg(${vaultSnapshots.sharePrice} order by ${vaultSnapshots.id} desc))[1]`,
      premiumPoolUsdc: sql<string>`(array_agg(${vaultSnapshots.premiumPoolUsdc} order by ${vaultSnapshots.id} desc))[1]`,
      cumulativePremiumUsdc: sql<string>`(array_agg(${vaultSnapshots.cumulativePremiumUsdc} order by ${vaultSnapshots.id} desc))[1]`,
    })
    .from(vaultSnapshots)
    .where(sql`${vaultSnapshots.ts} >= ${cutoff}`)
    .groupBy(bucket)
    .orderBy(bucket);
}
