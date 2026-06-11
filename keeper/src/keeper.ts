/**
 * Round-lifecycle decisions and the execution loop. `decide` is pure so the
 * policy is unit-testable; the loop wires it to the chain with retries.
 *
 * Safety: the keeper can only call start-round / settle-round (and feed the
 * devnet price relay). It cannot move user funds; the vault enforces all
 * value flows on-chain.
 */
import type { KeeperChain, OracleState, RoundState } from "./chain.js";

export type Action =
  | { type: "none"; reason: string }
  | { type: "relay-price"; then: "start" | "settle" }
  | { type: "start" }
  | { type: "settle" };

export interface DecideInputs {
  round: RoundState;
  oracle: OracleState;
  now: bigint;
  /** true when the schedule (cron or boot) wants a round open */
  startWanted: boolean;
  /** devnet price relay enabled */
  priceRelay: boolean;
}

export function decide(i: DecideInputs): Action {
  if (i.round.status === "active") {
    if (i.now < i.round.expiry) return { type: "none", reason: "round active, not yet expired" };
    // settlement price must be published at/after expiry
    if (!i.oracle.fresh || i.oracle.publishTime < i.round.expiry) {
      if (i.priceRelay) return { type: "relay-price", then: "settle" };
      return { type: "none", reason: "waiting for a post-expiry oracle update" };
    }
    return { type: "settle" };
  }

  // no active round
  if (!i.startWanted) return { type: "none", reason: "no round wanted yet" };
  if (!i.oracle.fresh) {
    if (i.priceRelay) return { type: "relay-price", then: "start" };
    return { type: "none", reason: "oracle stale; cannot open a round" };
  }
  return { type: "start" };
}

export interface KeeperStatus {
  lastTick: number;
  lastAction: string;
  lastTxId: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  round: { status: string; roundId: string; expiry: string } | null;
}

export interface LoopOpts {
  chain: KeeperChain;
  otmBps: number;
  iv1e8: bigint;
  priceRelay: boolean;
  priceSourceUrl: string;
  maxRetries: number;
  log: (msg: string, extra?: Record<string, unknown>) => void;
}

export function createKeeperLoop(opts: LoopOpts) {
  const status: KeeperStatus = {
    lastTick: 0,
    lastAction: "boot",
    lastTxId: null,
    lastError: null,
    consecutiveFailures: 0,
    round: null,
  };
  let startWanted = false;

  /** external BTC-USD for the devnet relay; falls back to last oracle price */
  async function relayPriceValue(oracle: OracleState): Promise<bigint> {
    if (opts.priceSourceUrl) {
      try {
        const res = await fetch(opts.priceSourceUrl);
        const body = (await res.json()) as Record<string, unknown>;
        // accept {price}, {data:{amount}} (coinbase), {bitcoin:{usd}} (coingecko)
        const raw =
          (body as any).price ??
          (body as any)?.data?.amount ??
          (body as any)?.bitcoin?.usd;
        const n = Number(raw);
        if (Number.isFinite(n) && n > 0) return BigInt(Math.round(n * 1e8));
      } catch {
        // fall through to last oracle price
      }
    }
    return oracle.price > 0n ? oracle.price : 10_421_000_000_000n;
  }

  async function withRetries<T>(label: string, fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < opts.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (e) {
        lastErr = e;
        const delay = Math.min(2 ** attempt * 2000, 60_000);
        opts.log(`${label} failed (attempt ${attempt + 1}/${opts.maxRetries}), retrying in ${delay}ms`, {
          error: (e as Error).message,
        });
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw lastErr;
  }

  return {
    status,
    requestStart() {
      startWanted = true;
      opts.log("round start requested by schedule");
    },

    async tick(): Promise<void> {
      status.lastTick = Math.floor(Date.now() / 1000);
      try {
        const [round, oracle, now] = await Promise.all([
          opts.chain.roundState(),
          opts.chain.oracleState(),
          opts.chain.now(),
        ]);
        status.round = {
          status: round.status,
          roundId: round.roundId.toString(),
          expiry: round.expiry.toString(),
        };

        const action = decide({ round, oracle, now, startWanted, priceRelay: opts.priceRelay });
        switch (action.type) {
          case "none":
            status.lastAction = `none (${action.reason})`;
            break;
          case "relay-price": {
            const price = await relayPriceValue(oracle);
            const txid = await withRetries("relay-price", () => opts.chain.relayPrice(price));
            status.lastAction = `relay-price -> ${action.then}`;
            status.lastTxId = txid;
            opts.log("relayed price", { txid, price: price.toString() });
            break;
          }
          case "start": {
            const txid = await withRetries("start-round", () =>
              opts.chain.startRound(opts.otmBps, opts.iv1e8)
            );
            startWanted = false;
            status.lastAction = "start-round";
            status.lastTxId = txid;
            opts.log("started round", { txid });
            break;
          }
          case "settle": {
            const txid = await withRetries("settle-round", () => opts.chain.settleRound());
            status.lastAction = "settle-round";
            status.lastTxId = txid;
            opts.log("settled round", { txid });
            // open the next round on the following tick
            startWanted = true;
            break;
          }
        }
        status.lastError = null;
        status.consecutiveFailures = 0;
      } catch (e) {
        status.lastError = (e as Error).message;
        status.consecutiveFailures++;
        opts.log("tick failed", { error: status.lastError, consecutiveFailures: status.consecutiveFailures });
        if (status.consecutiveFailures >= 5) {
          opts.log("ALERT: keeper failing repeatedly -- check oracle freshness, balance, and node", {
            consecutiveFailures: status.consecutiveFailures,
          });
        }
      }
    },
  };
}
