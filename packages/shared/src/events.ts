/**
 * Typed decoders for the vault's `print` event envelope.
 *
 * Every contract event is a tuple `{ e: (string-ascii ...), ... }`. The
 * indexer receives them from Chainhook as hex-encoded Clarity values; this
 * module is the single source of truth for their shapes. The API re-uses the
 * same types when serving indexed rows.
 */
import { hexToCV, cvToJSON } from "@stacks/transactions";

// ---------------------------------------------------------------------------
// event payload types (bigint for all on-chain amounts)
// ---------------------------------------------------------------------------

export interface DepositEvent {
  e: "deposit";
  user: string;
  amount: bigint; // sats
  shares: bigint;
  round: bigint;
}

export interface WithdrawEvent {
  e: "withdraw";
  user: string;
  shares: bigint;
  sbtcOut: bigint;
  round: bigint;
}

export interface WithdrawRequestedEvent {
  e: "withdraw-requested";
  user: string;
  shares: bigint;
  round: bigint;
}

export interface WithdrawRequestCancelledEvent {
  e: "withdraw-request-cancelled";
  user: string;
  shares: bigint;
}

export interface ClaimEvent {
  e: "claim";
  user: string;
  usdc: bigint; // micro-USDC
}

export interface SharesTransferredEvent {
  e: "shares-transferred";
  from: string;
  to: string;
  amount: bigint;
}

export interface RoundStartedEvent {
  e: "round-started";
  round: bigint;
  strike: bigint; // USD 1e8
  iv: bigint; // 1e8
  expiry: bigint; // unix seconds
  spot: bigint; // USD 1e8
  collateral: bigint; // sats
}

export interface CallBoughtEvent {
  e: "call-bought";
  round: bigint;
  buyer: string;
  contracts: bigint;
  premium: bigint; // micro-USDC
  strike: bigint; // USD 1e8
  spot: bigint; // USD 1e8
  /** tenor used for pricing, years 1e8 — full pricing reproducibility */
  tFp: bigint;
}

export interface RoundSettledEvent {
  e: "round-settled";
  round: bigint;
  settlementPrice: bigint; // USD 1e8
  payoutPerContract: bigint; // sats
  sbtcPaidOut: bigint; // sats
  premiumRetained: bigint; // micro-USDC
}

export interface ExercisedEvent {
  e: "exercised";
  round: bigint;
  buyer: string;
  payoutSbtc: bigint; // sats
}

export interface AdminEvent {
  e:
    | "keeper-set"
    | "owner-set"
    | "paused"
    | "unpaused"
    | "config-set"
    | "tokens-set"
    | "vault-set"
    | "max-age-set"
    | "adapter-owner-set"
    | "price-set";
  [key: string]: unknown;
}

export type VaultEvent =
  | DepositEvent
  | WithdrawEvent
  | WithdrawRequestedEvent
  | WithdrawRequestCancelledEvent
  | ClaimEvent
  | SharesTransferredEvent
  | RoundStartedEvent
  | CallBoughtEvent
  | RoundSettledEvent
  | ExercisedEvent
  | AdminEvent;

export const VAULT_EVENT_KINDS = [
  "deposit",
  "withdraw",
  "withdraw-requested",
  "withdraw-request-cancelled",
  "claim",
  "shares-transferred",
  "round-started",
  "call-bought",
  "round-settled",
  "exercised",
] as const;

// ---------------------------------------------------------------------------
// decoding
// ---------------------------------------------------------------------------

type PlainValue = string | bigint | boolean | null | PlainValue[] | { [k: string]: PlainValue };

/** Collapse cvToJSON output into plain JS values (uint/int -> bigint). */
export function cvJsonToPlain(node: unknown): PlainValue {
  if (node === null || node === undefined) return null;
  const n = node as { type?: string; value?: unknown };
  if (typeof n !== "object" || n.type === undefined) return node as PlainValue;
  const t = n.type;
  if (t === "uint" || t === "int") return BigInt(n.value as string);
  if (t === "bool") return Boolean(n.value);
  if (t === "principal" || t.startsWith("principal")) return String(n.value);
  if (t.startsWith("(string")) return String(n.value);
  if (t.startsWith("(buff")) return String(n.value);
  if (t.startsWith("(optional")) {
    return n.value === null ? null : cvJsonToPlain(n.value);
  }
  if (t.startsWith("(response")) {
    return cvJsonToPlain(n.value);
  }
  if (t === "tuple" || t.startsWith("(tuple")) {
    const out: { [k: string]: PlainValue } = {};
    for (const [k, v] of Object.entries(n.value as Record<string, unknown>)) {
      out[k] = cvJsonToPlain(v);
    }
    return out;
  }
  if (t.startsWith("(list")) {
    return (n.value as unknown[]).map(cvJsonToPlain);
  }
  // address / contract principals in older shapes
  if (typeof n.value === "string") return n.value;
  return n.value as PlainValue;
}

/** Decode a hex-encoded Clarity print value into a plain object. */
export function decodePrintHex(hex: string): Record<string, PlainValue> {
  const cv = hexToCV(hex.startsWith("0x") ? hex : `0x${hex}`);
  const plain = cvJsonToPlain(cvToJSON(cv));
  if (plain === null || typeof plain !== "object" || Array.isArray(plain)) {
    throw new Error("print payload is not a tuple");
  }
  return plain as Record<string, PlainValue>;
}

const big = (v: PlainValue): bigint => {
  if (typeof v === "bigint") return v;
  if (typeof v === "string" || typeof v === "number") return BigInt(v);
  throw new Error(`expected bigint-able value, got ${typeof v}`);
};
const str = (v: PlainValue): string => {
  if (typeof v !== "string") throw new Error(`expected string, got ${typeof v}`);
  return v;
};

/**
 * Map a decoded print tuple to a typed VaultEvent.
 * Returns null for tuples that are not Bachelier events (no `e` key).
 */
export function toVaultEvent(plain: Record<string, PlainValue>): VaultEvent | null {
  const e = plain["e"];
  if (typeof e !== "string") return null;
  switch (e) {
    case "deposit":
      return { e, user: str(plain["user"]), amount: big(plain["amount"]), shares: big(plain["shares"]), round: big(plain["round"]) };
    case "withdraw":
      return { e, user: str(plain["user"]), shares: big(plain["shares"]), sbtcOut: big(plain["sbtc-out"]), round: big(plain["round"]) };
    case "withdraw-requested":
      return { e, user: str(plain["user"]), shares: big(plain["shares"]), round: big(plain["round"]) };
    case "withdraw-request-cancelled":
      return { e, user: str(plain["user"]), shares: big(plain["shares"]) };
    case "claim":
      return { e, user: str(plain["user"]), usdc: big(plain["usdc"]) };
    case "shares-transferred":
      return { e, from: str(plain["from"]), to: str(plain["to"]), amount: big(plain["amount"]) };
    case "round-started":
      return {
        e,
        round: big(plain["round"]),
        strike: big(plain["strike"]),
        iv: big(plain["iv"]),
        expiry: big(plain["expiry"]),
        spot: big(plain["spot"]),
        collateral: big(plain["collateral"]),
      };
    case "call-bought":
      return {
        e,
        round: big(plain["round"]),
        buyer: str(plain["buyer"]),
        contracts: big(plain["contracts"]),
        premium: big(plain["premium"]),
        strike: big(plain["strike"]),
        spot: big(plain["spot"]),
        tFp: big(plain["t-fp"]),
      };
    case "round-settled":
      return {
        e,
        round: big(plain["round"]),
        settlementPrice: big(plain["settlement-price"]),
        payoutPerContract: big(plain["payout-per-contract"]),
        sbtcPaidOut: big(plain["sbtc-paid-out"]),
        premiumRetained: big(plain["premium-retained"]),
      };
    case "exercised":
      return { e, round: big(plain["round"]), buyer: str(plain["buyer"]), payoutSbtc: big(plain["payout-sbtc"]) };
    case "keeper-set":
    case "owner-set":
    case "paused":
    case "unpaused":
    case "config-set":
    case "tokens-set":
    case "vault-set":
    case "max-age-set":
    case "adapter-owner-set":
    case "price-set":
      return { ...plain, e } as AdminEvent;
    default:
      return null;
  }
}

/** One-shot: hex print payload -> typed event (or null if not ours). */
export function decodeVaultEvent(hex: string): VaultEvent | null {
  return toVaultEvent(decodePrintHex(hex));
}
