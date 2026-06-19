/**
 * Bachelier indexer schema. All on-chain amounts are NUMERIC (never JS
 * floats): sats for sBTC/shares, micro-USDC for premium, 1e8 fixed-point
 * for prices/iv. `canonical` flags rows from reorged-out blocks.
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  address: text("address").primaryKey(),
  firstSeenBlock: integer("first_seen_block").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** raw print events: audit log + idempotency + rebuild source */
export const eventsRaw = pgTable(
  "events_raw",
  {
    txId: text("tx_id").notNull(),
    eventIndex: integer("event_index").notNull(),
    txIndex: integer("tx_index").notNull().default(0),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull(),
    blockHeight: integer("block_height").notNull(),
    blockTime: integer("block_time"),
    canonical: boolean("canonical").notNull().default(true),
    processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.txId, t.eventIndex] }),
    index("events_raw_height_idx").on(t.blockHeight),
    index("events_raw_kind_idx").on(t.kind),
    index("events_raw_canonical_idx").on(t.canonical),
  ]
);

export const deposits = pgTable(
  "deposits",
  {
    id: serial("id").primaryKey(),
    address: text("address").notNull(),
    amountSbtc: numeric("amount_sbtc", { precision: 30, scale: 0 }).notNull(),
    shares: numeric("shares", { precision: 30, scale: 0 }).notNull(),
    roundId: integer("round_id"),
    txId: text("tx_id").notNull(),
    eventIndex: integer("event_index").notNull(),
    blockHeight: integer("block_height").notNull(),
    blockTime: integer("block_time"),
    canonical: boolean("canonical").notNull().default(true),
  },
  (t) => [
    uniqueIndex("deposits_event_uq").on(t.txId, t.eventIndex),
    index("deposits_address_idx").on(t.address),
    index("deposits_height_idx").on(t.blockHeight),
  ]
);

export const withdrawals = pgTable(
  "withdrawals",
  {
    id: serial("id").primaryKey(),
    address: text("address").notNull(),
    shares: numeric("shares", { precision: 30, scale: 0 }).notNull(),
    sbtcOut: numeric("sbtc_out", { precision: 30, scale: 0 }).notNull(),
    roundId: integer("round_id"),
    txId: text("tx_id").notNull(),
    eventIndex: integer("event_index").notNull(),
    blockHeight: integer("block_height").notNull(),
    blockTime: integer("block_time"),
    canonical: boolean("canonical").notNull().default(true),
  },
  (t) => [
    uniqueIndex("withdrawals_event_uq").on(t.txId, t.eventIndex),
    index("withdrawals_address_idx").on(t.address),
    index("withdrawals_height_idx").on(t.blockHeight),
  ]
);

export const premiumClaims = pgTable(
  "premium_claims",
  {
    id: serial("id").primaryKey(),
    address: text("address").notNull(),
    usdc: numeric("usdc", { precision: 30, scale: 0 }).notNull(),
    txId: text("tx_id").notNull(),
    eventIndex: integer("event_index").notNull(),
    blockHeight: integer("block_height").notNull(),
    blockTime: integer("block_time"),
    canonical: boolean("canonical").notNull().default(true),
  },
  (t) => [
    uniqueIndex("premium_claims_event_uq").on(t.txId, t.eventIndex),
    index("premium_claims_address_idx").on(t.address),
  ]
);

export const rounds = pgTable(
  "rounds",
  {
    roundId: integer("round_id").primaryKey(),
    status: text("status", { enum: ["active", "settled"] }).notNull(),
    strike: numeric("strike", { precision: 30, scale: 0 }).notNull(), // USD 1e8
    iv: numeric("iv", { precision: 30, scale: 0 }).notNull(), // 1e8
    spotOpen: numeric("spot_open", { precision: 30, scale: 0 }), // USD 1e8
    collateralAtOpen: numeric("collateral_at_open", { precision: 30, scale: 0 }), // sats
    openedAt: integer("opened_at").notNull(), // unix seconds
    expiry: integer("expiry").notNull(),
    contractsWritten: numeric("contracts_written", { precision: 30, scale: 0 }).notNull().default("0"),
    premiumCollectedUsdc: numeric("premium_collected_usdc", { precision: 30, scale: 0 }).notNull().default("0"),
    settlementPrice: numeric("settlement_price", { precision: 30, scale: 0 }),
    payoutPerContract: numeric("payout_per_contract", { precision: 30, scale: 0 }),
    sbtcPaidOut: numeric("sbtc_paid_out", { precision: 30, scale: 0 }),
    openedTx: text("opened_tx"),
    settledTx: text("settled_tx"),
  },
  (t) => [index("rounds_status_idx").on(t.status)]
);

export const positions = pgTable(
  "positions",
  {
    id: serial("id").primaryKey(),
    roundId: integer("round_id").notNull(),
    buyer: text("buyer").notNull(),
    contracts: numeric("contracts", { precision: 30, scale: 0 }).notNull(),
    premiumPaidUsdc: numeric("premium_paid_usdc", { precision: 30, scale: 0 }).notNull(),
    strike: numeric("strike", { precision: 30, scale: 0 }).notNull(),
    settled: boolean("settled").notNull().default(false),
    payoutSbtc: numeric("payout_sbtc", { precision: 30, scale: 0 }),
  },
  (t) => [
    uniqueIndex("positions_round_buyer_uq").on(t.roundId, t.buyer),
    index("positions_buyer_idx").on(t.buyer),
    index("positions_round_idx").on(t.roundId),
  ]
);

/** vault state after every state-changing event block (drives charts/APY) */
export const vaultSnapshots = pgTable(
  "vault_snapshots",
  {
    id: serial("id").primaryKey(),
    blockHeight: integer("block_height").notNull(),
    ts: integer("ts").notNull(), // unix seconds
    tvlSbtc: numeric("tvl_sbtc", { precision: 30, scale: 0 }).notNull(),
    reservedPayoutSbtc: numeric("reserved_payout_sbtc", { precision: 30, scale: 0 }).notNull().default("0"),
    totalShares: numeric("total_shares", { precision: 30, scale: 0 }).notNull(),
    sharePrice: numeric("share_price", { precision: 30, scale: 0 }).notNull(), // 1e8 fp
    premiumPoolUsdc: numeric("premium_pool_usdc", { precision: 30, scale: 0 }).notNull(),
    cumulativePremiumUsdc: numeric("cumulative_premium_usdc", { precision: 30, scale: 0 }).notNull(),
  },
  (t) => [index("vault_snapshots_height_idx").on(t.blockHeight), index("vault_snapshots_ts_idx").on(t.ts)]
);

/** optional BTC-USD cache (fed by indexer from round/buy events + keeper) */
export const prices = pgTable(
  "prices",
  {
    id: serial("id").primaryKey(),
    ts: integer("ts").notNull(),
    btcUsd: numeric("btc_usd", { precision: 30, scale: 0 }).notNull(), // 1e8
    source: text("source").notNull(),
  },
  (t) => [index("prices_ts_idx").on(t.ts)]
);

/** single-row indexer cursor */
export const indexerState = pgTable("indexer_state", {
  id: integer("id").primaryKey().default(1),
  lastBlockHeight: integer("last_block_height").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
