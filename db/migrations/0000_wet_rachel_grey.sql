CREATE TABLE "deposits" (
	"id" serial PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"amount_sbtc" numeric(30, 0) NOT NULL,
	"shares" numeric(30, 0) NOT NULL,
	"round_id" integer,
	"tx_id" text NOT NULL,
	"event_index" integer NOT NULL,
	"block_height" integer NOT NULL,
	"block_time" integer,
	"canonical" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events_raw" (
	"tx_id" text NOT NULL,
	"event_index" integer NOT NULL,
	"tx_index" integer DEFAULT 0 NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"block_height" integer NOT NULL,
	"block_time" integer,
	"canonical" boolean DEFAULT true NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_raw_tx_id_event_index_pk" PRIMARY KEY("tx_id","event_index")
);
--> statement-breakpoint
CREATE TABLE "indexer_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"last_block_height" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"round_id" integer NOT NULL,
	"buyer" text NOT NULL,
	"contracts" numeric(30, 0) NOT NULL,
	"premium_paid_usdc" numeric(30, 0) NOT NULL,
	"strike" numeric(30, 0) NOT NULL,
	"settled" boolean DEFAULT false NOT NULL,
	"payout_sbtc" numeric(30, 0)
);
--> statement-breakpoint
CREATE TABLE "premium_claims" (
	"id" serial PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"usdc" numeric(30, 0) NOT NULL,
	"tx_id" text NOT NULL,
	"event_index" integer NOT NULL,
	"block_height" integer NOT NULL,
	"block_time" integer,
	"canonical" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prices" (
	"id" serial PRIMARY KEY NOT NULL,
	"ts" integer NOT NULL,
	"btc_usd" numeric(30, 0) NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rounds" (
	"round_id" integer PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"strike" numeric(30, 0) NOT NULL,
	"iv" numeric(30, 0) NOT NULL,
	"spot_open" numeric(30, 0),
	"collateral_at_open" numeric(30, 0),
	"opened_at" integer NOT NULL,
	"expiry" integer NOT NULL,
	"contracts_written" numeric(30, 0) DEFAULT '0' NOT NULL,
	"premium_collected_usdc" numeric(30, 0) DEFAULT '0' NOT NULL,
	"settlement_price" numeric(30, 0),
	"payout_per_contract" numeric(30, 0),
	"sbtc_paid_out" numeric(30, 0),
	"opened_tx" text,
	"settled_tx" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"address" text PRIMARY KEY NOT NULL,
	"first_seen_block" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"block_height" integer NOT NULL,
	"ts" integer NOT NULL,
	"tvl_sbtc" numeric(30, 0) NOT NULL,
	"reserved_payout_sbtc" numeric(30, 0) DEFAULT '0' NOT NULL,
	"total_shares" numeric(30, 0) NOT NULL,
	"share_price" numeric(30, 0) NOT NULL,
	"premium_pool_usdc" numeric(30, 0) NOT NULL,
	"cumulative_premium_usdc" numeric(30, 0) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "withdrawals" (
	"id" serial PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"shares" numeric(30, 0) NOT NULL,
	"sbtc_out" numeric(30, 0) NOT NULL,
	"round_id" integer,
	"tx_id" text NOT NULL,
	"event_index" integer NOT NULL,
	"block_height" integer NOT NULL,
	"block_time" integer,
	"canonical" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "deposits_event_uq" ON "deposits" USING btree ("tx_id","event_index");--> statement-breakpoint
CREATE INDEX "deposits_address_idx" ON "deposits" USING btree ("address");--> statement-breakpoint
CREATE INDEX "deposits_height_idx" ON "deposits" USING btree ("block_height");--> statement-breakpoint
CREATE INDEX "events_raw_height_idx" ON "events_raw" USING btree ("block_height");--> statement-breakpoint
CREATE INDEX "events_raw_kind_idx" ON "events_raw" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "events_raw_canonical_idx" ON "events_raw" USING btree ("canonical");--> statement-breakpoint
CREATE UNIQUE INDEX "positions_round_buyer_uq" ON "positions" USING btree ("round_id","buyer");--> statement-breakpoint
CREATE INDEX "positions_buyer_idx" ON "positions" USING btree ("buyer");--> statement-breakpoint
CREATE INDEX "positions_round_idx" ON "positions" USING btree ("round_id");--> statement-breakpoint
CREATE UNIQUE INDEX "premium_claims_event_uq" ON "premium_claims" USING btree ("tx_id","event_index");--> statement-breakpoint
CREATE INDEX "premium_claims_address_idx" ON "premium_claims" USING btree ("address");--> statement-breakpoint
CREATE INDEX "prices_ts_idx" ON "prices" USING btree ("ts");--> statement-breakpoint
CREATE INDEX "rounds_status_idx" ON "rounds" USING btree ("status");--> statement-breakpoint
CREATE INDEX "vault_snapshots_height_idx" ON "vault_snapshots" USING btree ("block_height");--> statement-breakpoint
CREATE INDEX "vault_snapshots_ts_idx" ON "vault_snapshots" USING btree ("ts");--> statement-breakpoint
CREATE UNIQUE INDEX "withdrawals_event_uq" ON "withdrawals" USING btree ("tx_id","event_index");--> statement-breakpoint
CREATE INDEX "withdrawals_address_idx" ON "withdrawals" USING btree ("address");--> statement-breakpoint
CREATE INDEX "withdrawals_height_idx" ON "withdrawals" USING btree ("block_height");