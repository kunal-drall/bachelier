/**
 * Event projection. The chain is the source of truth: `events_raw` is the
 * canonical-flagged audit log keyed by (tx_id, event_index), and every other
 * table is a projection that can be rebuilt from it at any time.
 *
 * - apply path: insert raw (ON CONFLICT DO NOTHING); only newly inserted
 *   events are projected, which makes duplicate webhook deliveries no-ops.
 * - rollback path: mark the affected raw events canonical=false, then
 *   rebuild all projections from the canonical log (simple and always
 *   correct at v1 volumes).
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import {
  deposits,
  eventsRaw,
  indexerState,
  positions,
  premiumClaims,
  prices,
  rounds,
  users,
  vaultSnapshots,
  withdrawals,
  schema,
} from "@bachelier/db";
import { toVaultEvent, type VaultEvent } from "@bachelier/shared/events";
import type { ExtractedEvent } from "./chainhook.js";

// works with node-postgres in prod and pglite in tests
export type AnyDb = PgDatabase<any, typeof schema>;

export interface VaultTotals {
  tvlSbtc: bigint;
  reservedPayoutSbtc: bigint;
  totalShares: bigint;
  premiumPoolUsdc: bigint;
  cumulativePremiumUsdc: bigint;
}

export const ZERO_TOTALS: VaultTotals = {
  tvlSbtc: 0n,
  reservedPayoutSbtc: 0n,
  totalShares: 0n,
  premiumPoolUsdc: 0n,
  cumulativePremiumUsdc: 0n,
};

export async function loadTotals(db: AnyDb): Promise<VaultTotals> {
  const [snap] = await db
    .select()
    .from(vaultSnapshots)
    .orderBy(sql`${vaultSnapshots.id} desc`)
    .limit(1);
  if (!snap) return { ...ZERO_TOTALS };
  return {
    tvlSbtc: BigInt(snap.tvlSbtc),
    reservedPayoutSbtc: BigInt(snap.reservedPayoutSbtc),
    totalShares: BigInt(snap.totalShares),
    premiumPoolUsdc: BigInt(snap.premiumPoolUsdc),
    cumulativePremiumUsdc: BigInt(snap.cumulativePremiumUsdc),
  };
}

/** apply one decoded event to the projection tables + running totals */
async function projectEvent(db: AnyDb, ev: ExtractedEvent, totals: VaultTotals): Promise<void> {
  const e = ev.event;
  const base = {
    txId: ev.txId,
    eventIndex: ev.eventIndex,
    blockHeight: ev.blockHeight,
    blockTime: ev.blockTime,
    canonical: true,
  };

  switch (e.e) {
    case "deposit": {
      await ensureUser(db, e.user, ev.blockHeight);
      await db
        .insert(deposits)
        .values({
          ...base,
          address: e.user,
          amountSbtc: e.amount.toString(),
          shares: e.shares.toString(),
          roundId: Number(e.round),
        })
        .onConflictDoNothing();
      totals.tvlSbtc += e.amount;
      totals.totalShares += e.shares;
      break;
    }
    case "withdraw": {
      await db
        .insert(withdrawals)
        .values({
          ...base,
          address: e.user,
          shares: e.shares.toString(),
          sbtcOut: e.sbtcOut.toString(),
          roundId: Number(e.round),
        })
        .onConflictDoNothing();
      totals.tvlSbtc -= e.sbtcOut;
      totals.totalShares -= e.shares;
      break;
    }
    case "claim": {
      await db
        .insert(premiumClaims)
        .values({ ...base, address: e.user, usdc: e.usdc.toString() })
        .onConflictDoNothing();
      totals.premiumPoolUsdc -= e.usdc;
      break;
    }
    case "round-started": {
      await db
        .insert(rounds)
        .values({
          roundId: Number(e.round),
          status: "active",
          strike: e.strike.toString(),
          iv: e.iv.toString(),
          spotOpen: e.spot.toString(),
          collateralAtOpen: e.collateral.toString(),
          openedAt: ev.blockTime ?? 0,
          expiry: Number(e.expiry),
          openedTx: ev.txId,
        })
        .onConflictDoUpdate({
          target: rounds.roundId,
          set: {
            status: "active",
            strike: e.strike.toString(),
            iv: e.iv.toString(),
            spotOpen: e.spot.toString(),
            collateralAtOpen: e.collateral.toString(),
            openedAt: ev.blockTime ?? 0,
            expiry: Number(e.expiry),
            openedTx: ev.txId,
          },
        });
      await db.insert(prices).values({
        ts: ev.blockTime ?? Math.floor(Date.now() / 1000),
        btcUsd: e.spot.toString(),
        source: "round-started",
      });
      break;
    }
    case "call-bought": {
      await ensureUser(db, e.buyer, ev.blockHeight);
      const rid = Number(e.round);
      await db
        .update(rounds)
        .set({
          contractsWritten: sql`${rounds.contractsWritten} + ${e.contracts.toString()}::numeric`,
          premiumCollectedUsdc: sql`${rounds.premiumCollectedUsdc} + ${e.premium.toString()}::numeric`,
        })
        .where(eq(rounds.roundId, rid));
      await db
        .insert(positions)
        .values({
          roundId: rid,
          buyer: e.buyer,
          contracts: e.contracts.toString(),
          premiumPaidUsdc: e.premium.toString(),
          strike: e.strike.toString(),
          settled: false,
        })
        .onConflictDoUpdate({
          target: [positions.roundId, positions.buyer],
          set: {
            contracts: sql`${positions.contracts} + ${e.contracts.toString()}::numeric`,
            premiumPaidUsdc: sql`${positions.premiumPaidUsdc} + ${e.premium.toString()}::numeric`,
          },
        });
      await db.insert(prices).values({
        ts: ev.blockTime ?? Math.floor(Date.now() / 1000),
        btcUsd: e.spot.toString(),
        source: "call-bought",
      });
      totals.premiumPoolUsdc += e.premium;
      totals.cumulativePremiumUsdc += e.premium;
      break;
    }
    case "round-settled": {
      const rid = Number(e.round);
      await db
        .update(rounds)
        .set({
          status: "settled",
          settlementPrice: e.settlementPrice.toString(),
          payoutPerContract: e.payoutPerContract.toString(),
          sbtcPaidOut: e.sbtcPaidOut.toString(),
          settledTx: ev.txId,
        })
        .where(eq(rounds.roundId, rid));
      await db.update(positions).set({ settled: true }).where(eq(positions.roundId, rid));
      await db.insert(prices).values({
        ts: ev.blockTime ?? Math.floor(Date.now() / 1000),
        btcUsd: e.settlementPrice.toString(),
        source: "round-settled",
      });
      totals.tvlSbtc -= e.sbtcPaidOut;
      totals.reservedPayoutSbtc += e.sbtcPaidOut;
      break;
    }
    case "exercised": {
      await db
        .update(positions)
        .set({ payoutSbtc: e.payoutSbtc.toString() })
        .where(and(eq(positions.roundId, Number(e.round)), eq(positions.buyer, e.buyer)));
      totals.reservedPayoutSbtc -= e.payoutSbtc;
      break;
    }
    // accounting-neutral events live in events_raw only
    case "withdraw-requested":
    case "withdraw-request-cancelled":
    case "shares-transferred":
    default:
      break;
  }
}

async function ensureUser(db: AnyDb, address: string, blockHeight: number): Promise<void> {
  await db.insert(users).values({ address, firstSeenBlock: blockHeight }).onConflictDoNothing();
}

const STATE_CHANGING = new Set([
  "deposit",
  "withdraw",
  "claim",
  "call-bought",
  "round-settled",
  "exercised",
]);

/**
 * Apply one block's events transactionally. Returns how many events were new.
 * Duplicate (tx_id, event_index) pairs are ignored entirely.
 */
export async function applyBlock(db: AnyDb, events: ExtractedEvent[], blockHeight: number, blockTime: number | null): Promise<number> {
  let applied = 0;
  await db.transaction(async (tx: AnyDb) => {
    const totals = await loadTotals(tx);
    let touched = false;

    for (const ev of events) {
      // insert fresh events; resurrect rolled-back ones (canonical=false).
      // already-canonical duplicates return no row and are skipped.
      const inserted = await tx
        .insert(eventsRaw)
        .values({
          txId: ev.txId,
          eventIndex: ev.eventIndex,
          txIndex: ev.txIndex,
          kind: ev.event.e,
          payload: serializePayload(ev.rawPayload),
          blockHeight: ev.blockHeight,
          blockTime: ev.blockTime,
          canonical: true,
        })
        .onConflictDoUpdate({
          target: [eventsRaw.txId, eventsRaw.eventIndex],
          set: { canonical: true },
          setWhere: sql`${eventsRaw.canonical} = false`,
        })
        .returning({ txId: eventsRaw.txId });

      if (inserted.length === 0) continue; // duplicate delivery
      applied++;
      await projectEvent(tx, ev, totals);
      if (STATE_CHANGING.has(ev.event.e)) touched = true;
    }

    if (touched) {
      await writeSnapshot(tx, totals, blockHeight, blockTime);
    }
    await tx
      .insert(indexerState)
      .values({ id: 1, lastBlockHeight: blockHeight })
      .onConflictDoUpdate({
        target: indexerState.id,
        set: { lastBlockHeight: sql`greatest(${indexerState.lastBlockHeight}, ${blockHeight})`, updatedAt: sql`now()` },
      });
  });
  return applied;
}

async function writeSnapshot(db: AnyDb, totals: VaultTotals, blockHeight: number, blockTime: number | null): Promise<void> {
  const sharePrice =
    totals.totalShares > 0n ? (totals.tvlSbtc * 100_000_000n) / totals.totalShares : 100_000_000n;
  await db.insert(vaultSnapshots).values({
    blockHeight,
    ts: blockTime ?? Math.floor(Date.now() / 1000),
    tvlSbtc: totals.tvlSbtc.toString(),
    reservedPayoutSbtc: totals.reservedPayoutSbtc.toString(),
    totalShares: totals.totalShares.toString(),
    sharePrice: sharePrice.toString(),
    premiumPoolUsdc: totals.premiumPoolUsdc.toString(),
    cumulativePremiumUsdc: totals.cumulativePremiumUsdc.toString(),
  });
}

/** mark raw events from rolled-back blocks non-canonical, then rebuild */
export async function rollbackBlocks(db: AnyDb, blockHeights: number[]): Promise<void> {
  if (blockHeights.length === 0) return;
  await db
    .update(eventsRaw)
    .set({ canonical: false })
    .where(inArray(eventsRaw.blockHeight, blockHeights));
  await rebuildProjections(db);
}

/** wipe and replay every projection from the canonical raw log */
export async function rebuildProjections(db: AnyDb): Promise<void> {
  await db.transaction(async (tx: AnyDb) => {
    await tx.delete(deposits);
    await tx.delete(withdrawals);
    await tx.delete(premiumClaims);
    await tx.delete(positions);
    await tx.delete(rounds);
    await tx.delete(vaultSnapshots);

    const raw = await tx
      .select()
      .from(eventsRaw)
      .where(eq(eventsRaw.canonical, true))
      .orderBy(asc(eventsRaw.blockHeight), asc(eventsRaw.txIndex), asc(eventsRaw.eventIndex));

    const totals = { ...ZERO_TOTALS };
    let currentBlock: number | null = null;
    let currentTime: number | null = null;
    let touched = false;

    const flush = async () => {
      if (currentBlock !== null && touched) await writeSnapshot(tx, totals, currentBlock, currentTime);
      touched = false;
    };

    for (const row of raw) {
      if (currentBlock !== null && row.blockHeight !== currentBlock) await flush();
      currentBlock = row.blockHeight;
      currentTime = row.blockTime;

      const event = toVaultEvent(reviveBigints(row.payload as Record<string, unknown>)) as VaultEvent | null;
      if (!event) continue;
      const ev: ExtractedEvent = {
        txId: row.txId,
        txIndex: row.txIndex,
        eventIndex: row.eventIndex,
        blockHeight: row.blockHeight,
        blockTime: row.blockTime,
        event,
        rawPayload: row.payload as Record<string, unknown>,
      };
      await projectEvent(tx, ev, totals);
      if (STATE_CHANGING.has(event.e)) touched = true;
    }
    await flush();
  });
}

/** jsonb cannot hold bigints; store them as strings and revive on read */
function serializePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) out[k] = typeof v === "bigint" ? v.toString() : v;
  return out;
}

function reviveBigints(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    out[k] = typeof v === "string" && /^-?\d+$/.test(v) && k !== "e" ? BigInt(v) : v;
  }
  return out;
}

export async function lastIndexedBlock(db: AnyDb): Promise<number> {
  const [row] = await db.select().from(indexerState).where(eq(indexerState.id, 1));
  return row?.lastBlockHeight ?? 0;
}
