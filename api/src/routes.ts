import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import {
  deposits,
  indexerState,
  positions,
  prices,
  rounds,
  schema,
  vaultSnapshots,
  withdrawals,
} from "@bachelier/db";
import { latestSnapshot, snapshotSeries, trailingApy } from "@bachelier/db/queries";
import { apyFromWeekly, bsCall, quote as tsQuote } from "@bachelier/shared/bs";
import {
  HealthDto,
  PriceDto,
  QuoteDto,
  QuoteQueryDto,
  RoundDetailDto,
  RoundsPageDto,
  RoundSummaryDto,
  SnapshotDto,
  TxStatusDto,
  UserPositionsDto,
  VaultDto,
  VaultHistoryDto,
} from "@bachelier/shared/dto";
import type { ChainReader } from "./chain.js";

export type AnyDb = PgDatabase<any, typeof schema>;

export interface ApiOpts {
  db: AnyDb;
  chain: ChainReader;
  stacksApiUrl: string;
  corsOrigin?: string | boolean;
  riskFreeRate: number;
  roundLenSecs: number;
  defaultIv: number;
  defaultOtmBps: number;
  /** zod-validate responses (on in dev/test) */
  validateResponses?: boolean;
}

const RANGES: Record<string, number> = {
  "7d": 7 * 86400,
  "30d": 30 * 86400,
  "90d": 90 * 86400,
  all: 10 * 365 * 86400,
};
const INTERVALS: Record<string, number> = { "1h": 3600, "6h": 6 * 3600, "1d": 86400 };

export async function buildApi(opts: ApiOpts): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  await app.register(cors, { origin: opts.corsOrigin ?? true });
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });

  const { db, chain } = opts;
  const validate = <T>(schema_: { parse: (v: unknown) => T }, value: unknown): T =>
    opts.validateResponses === false ? (value as T) : schema_.parse(value);

  const cacheHeader = (secs: number) => ({ "cache-control": `public, max-age=${secs}` });

  async function latestBtcUsd(): Promise<number | null> {
    const live = await chain.readPrice();
    if (live) return Number(live.btcUsd) / 1e8;
    const [row] = await db.select().from(prices).orderBy(desc(prices.id)).limit(1);
    return row ? Number(row.btcUsd) / 1e8 : null;
  }

  function roundToSummary(r: typeof rounds.$inferSelect) {
    return {
      roundId: r.roundId,
      status: r.status,
      strike: r.strike,
      iv: r.iv,
      spotOpen: r.spotOpen,
      openedAt: r.openedAt,
      expiry: r.expiry,
      contractsWritten: r.contractsWritten,
      premiumCollectedUsdc: r.premiumCollectedUsdc,
      settlementPrice: r.settlementPrice,
      payoutPerContract: r.payoutPerContract,
      sbtcPaidOut: r.sbtcPaidOut,
    };
  }

  // --- health ----------------------------------------------------------------
  app.get("/health", async (_req, reply) => {
    let lastIndexedBlock: number | null = null;
    try {
      const [row] = await db.select().from(indexerState).where(eq(indexerState.id, 1));
      lastIndexedBlock = row?.lastBlockHeight ?? null;
    } catch {
      // db unreachable -> still answer, ok=false
      return reply.code(503).send(validate(HealthDto, { ok: false, lastIndexedBlock: null }));
    }
    return validate(HealthDto, { ok: true, lastIndexedBlock });
  });

  // --- vault ------------------------------------------------------------------
  app.get("/vault", async (_req, reply) => {
    const snap = await latestSnapshot(db as any);
    const [active] = await db
      .select()
      .from(rounds)
      .where(eq(rounds.status, "active"))
      .orderBy(desc(rounds.roundId))
      .limit(1);

    const tvlSbtc = BigInt(snap?.tvlSbtc ?? "0");
    const written = active ? BigInt(active.contractsWritten) : 0n;
    const capContracts = tvlSbtc / 100_000_000n;
    const capacitySbtc = capContracts > written ? (capContracts - written) * 100_000_000n : 0n;

    const btcUsd = await latestBtcUsd();
    const realized = await trailingApy(db as any);

    // forward APY from the live round (or default params when idle)
    let forward: number | null = null;
    if (btcUsd) {
      const spot = btcUsd;
      const strike = active ? Number(active.strike) / 1e8 : spot * (1 + opts.defaultOtmBps / 10000);
      const iv = active ? Number(active.iv) / 1e8 : opts.defaultIv;
      const tYears = active
        ? Math.max(active.expiry - Date.now() / 1000, 60) / 31_536_000
        : opts.roundLenSecs / 31_536_000;
      const prem = bsCall(spot, strike, iv, opts.roundLenSecs / 31_536_000, opts.riskFreeRate);
      if (Number.isFinite(prem) && prem > 0) forward = apyFromWeekly(prem / spot);
      void tYears;
    }

    const body = {
      tvlSbtc: tvlSbtc.toString(),
      reservedPayoutSbtc: snap?.reservedPayoutSbtc ?? "0",
      totalShares: snap?.totalShares ?? "0",
      sharePrice: snap?.sharePrice ?? "100000000",
      premiumPoolUsdc: snap?.premiumPoolUsdc ?? "0",
      cumulativePremiumUsdc: snap?.cumulativePremiumUsdc ?? "0",
      currentRound: active ? roundToSummary(active) : null,
      trailingApy: realized,
      forwardApy: forward,
      capacitySbtc: capacitySbtc.toString(),
      btcUsd,
    };
    return reply.headers(cacheHeader(5)).send(validate(VaultDto, body));
  });

  // --- vault history -----------------------------------------------------------
  app.get<{ Querystring: { range?: string; interval?: string } }>("/vault/history", async (req, reply) => {
    const range = RANGES[req.query.range ?? "30d"] ? (req.query.range ?? "30d") : "30d";
    const interval = INTERVALS[req.query.interval ?? "1d"] ? (req.query.interval ?? "1d") : "1d";
    const rows = await snapshotSeries(db as any, RANGES[range], INTERVALS[interval]);
    const points = rows.map((r) =>
      validate(SnapshotDto, {
        ts: Number(r.ts),
        blockHeight: Number(r.blockHeight),
        tvlSbtc: r.tvlSbtc,
        totalShares: r.totalShares,
        sharePrice: r.sharePrice,
        premiumPoolUsdc: r.premiumPoolUsdc,
        cumulativePremiumUsdc: r.cumulativePremiumUsdc,
        apy: null,
      })
    );
    return reply.headers(cacheHeader(60)).send(validate(VaultHistoryDto, { range, interval, points }));
  });

  // --- rounds -------------------------------------------------------------------
  app.get<{ Querystring: { limit?: string; cursor?: string } }>("/rounds", async (req, reply) => {
    const limit = Math.min(Math.max(Number(req.query.limit ?? 20), 1), 100);
    const cursor = req.query.cursor ? Number(req.query.cursor) : null;
    const where = cursor ? lt(rounds.roundId, cursor) : undefined;
    const rows = await db
      .select()
      .from(rounds)
      .where(where)
      .orderBy(desc(rounds.roundId))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const body = {
      rounds: page.map(roundToSummary),
      nextCursor: rows.length > limit ? page[page.length - 1]!.roundId : null,
    };
    return reply.headers(cacheHeader(15)).send(validate(RoundsPageDto, body));
  });

  app.get<{ Params: { id: string } }>("/rounds/:id", async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: "bad round id" });
    const [round] = await db.select().from(rounds).where(eq(rounds.roundId, id));
    if (!round) return reply.code(404).send({ error: "round not found" });
    const pos = await db.select().from(positions).where(eq(positions.roundId, id));
    const body = {
      ...roundToSummary(round),
      positions: pos.map((p) => ({
        roundId: p.roundId,
        buyer: p.buyer,
        contracts: p.contracts,
        premiumPaidUsdc: p.premiumPaidUsdc,
        strike: p.strike,
        settled: p.settled,
        payoutSbtc: p.payoutSbtc,
      })),
      buyers: pos.length,
    };
    return reply.headers(cacheHeader(15)).send(validate(RoundDetailDto, body));
  });

  // --- positions -----------------------------------------------------------------
  app.get<{ Params: { address: string } }>("/positions/:address", async (req, reply) => {
    const address = req.params.address;
    if (!/^S[TPM][0-9A-Z]{20,}/.test(address)) return reply.code(400).send({ error: "bad address" });

    const live = await chain.getUser(address);
    const deps = await db
      .select()
      .from(deposits)
      .where(and(eq(deposits.address, address), eq(deposits.canonical, true)))
      .orderBy(desc(deposits.blockHeight));
    const takerPos = await db.select().from(positions).where(eq(positions.buyer, address));

    // indexed fallback when the chain is unreachable: shares from flows
    let fallbackShares = 0n;
    if (!live) {
      const [d] = await db
        .select({ s: sql<string>`coalesce(sum(${deposits.shares}), 0)` })
        .from(deposits)
        .where(and(eq(deposits.address, address), eq(deposits.canonical, true)));
      const [w] = await db
        .select({ s: sql<string>`coalesce(sum(${withdrawals.shares}), 0)` })
        .from(withdrawals)
        .where(and(eq(withdrawals.address, address), eq(withdrawals.canonical, true)));
      fallbackShares = BigInt(d?.s ?? "0") - BigInt(w?.s ?? "0");
      if (fallbackShares < 0n) fallbackShares = 0n;
    }
    const snap = await latestSnapshot(db as any);
    const fallbackValue =
      snap && BigInt(snap.totalShares) > 0n
        ? (fallbackShares * BigInt(snap.tvlSbtc)) / BigInt(snap.totalShares)
        : 0n;

    const body = {
      address,
      shares: (live?.shares ?? fallbackShares).toString(),
      valueSbtc: (live?.valueSbtc ?? fallbackValue).toString(),
      claimablePremiumUsdc: (live?.claimablePremiumUsdc ?? 0n).toString(),
      queuedShares: (live?.queuedShares ?? 0n).toString(),
      deposits: deps.map((d) => ({
        amountSbtc: d.amountSbtc,
        shares: d.shares,
        roundId: d.roundId,
        txId: d.txId,
        blockHeight: d.blockHeight,
        ts: d.blockTime,
      })),
      takerPositions: takerPos.map((p) => ({
        roundId: p.roundId,
        buyer: p.buyer,
        contracts: p.contracts,
        premiumPaidUsdc: p.premiumPaidUsdc,
        strike: p.strike,
        settled: p.settled,
        payoutSbtc: p.payoutSbtc,
      })),
    };
    return reply.headers(cacheHeader(5)).send(validate(UserPositionsDto, body));
  });

  // --- quote ----------------------------------------------------------------------
  app.get("/quote", async (req, reply) => {
    const parsed = QuoteQueryDto.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { notional, otmBps, iv } = parsed.data;

    const btcUsd = await latestBtcUsd();
    if (!btcUsd) return reply.code(503).send({ error: "no price available" });

    const tYears = opts.roundLenSecs / 31_536_000;
    const q = tsQuote({
      spot: btcUsd,
      otmBps,
      iv,
      tYears,
      r: opts.riskFreeRate,
      contracts: notional,
    });

    // on-chain parity check via vault.preview-quote (best effort)
    let onChain: { premiumPerSbtcUsdc: number; strike: number; agreesWithinPct: number } | null = null;
    const chainQuote = await chain.previewQuote(otmBps, BigInt(Math.round(iv * 1e8)), Math.max(1, Math.round(notional)));
    if (chainQuote) {
      const chainPrem = Number(chainQuote.premiumPerContractUsdc) / 1e6;
      const diff = q.premiumPerSbtcUsd > 0 ? Math.abs(chainPrem - q.premiumPerSbtcUsd) / q.premiumPerSbtcUsd : 0;
      onChain = {
        premiumPerSbtcUsdc: chainPrem,
        strike: Number(chainQuote.strike) / 1e8,
        agreesWithinPct: diff * 100,
      };
    }

    const body = {
      spot: q.spot,
      strike: q.strike,
      premiumPerSbtcUsdc: q.premiumPerSbtcUsd,
      premiumTotalUsdc: q.premiumTotalUsd,
      weeklyPct: q.weeklyPct,
      apy: q.apy,
      downsideCushionPct: q.downsideCushionPct,
      breakeven: q.breakeven,
      capValue: q.capValue,
      tYears,
      r: opts.riskFreeRate,
      onChain,
    };
    return reply.headers(cacheHeader(5)).send(validate(QuoteDto, body));
  });

  // --- price ----------------------------------------------------------------------
  app.get("/price", async (_req, reply) => {
    const live = await chain.readPrice();
    if (live) {
      return reply.headers(cacheHeader(10)).send(
        validate(PriceDto, {
          btcUsd: Number(live.btcUsd) / 1e8,
          publishTime: live.publishTime,
          source: "pyth",
        })
      );
    }
    const [row] = await db.select().from(prices).orderBy(desc(prices.id)).limit(1);
    if (!row) return reply.code(503).send({ error: "no price available" });
    return reply.headers(cacheHeader(10)).send(
      validate(PriceDto, { btcUsd: Number(row.btcUsd) / 1e8, publishTime: row.ts, source: row.source })
    );
  });

  // --- tx status (proxy) -------------------------------------------------------------
  app.get<{ Params: { txid: string } }>("/tx/:txid", async (req, reply) => {
    const txid = req.params.txid.startsWith("0x") ? req.params.txid : `0x${req.params.txid}`;
    if (!/^0x[0-9a-fA-F]{64}$/.test(txid)) return reply.code(400).send({ error: "bad txid" });
    try {
      const res = await fetch(`${opts.stacksApiUrl}/extended/v1/tx/${txid}`);
      if (res.status === 404) {
        return validate(TxStatusDto, { txId: txid, status: "not_found", blockHeight: null });
      }
      const tx = (await res.json()) as { tx_status: string; block_height?: number };
      const status =
        tx.tx_status === "success"
          ? "success"
          : tx.tx_status === "pending"
            ? "pending"
            : tx.tx_status === "abort_by_post_condition"
              ? "abort_by_post_condition"
              : "abort_by_response";
      return validate(TxStatusDto, { txId: txid, status, blockHeight: tx.block_height ?? null });
    } catch {
      return reply.code(502).send({ error: "stacks api unreachable" });
    }
  });

  return app;
}
