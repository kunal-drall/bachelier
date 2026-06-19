/**
 * Display formatters. Chain amounts are BigInt; we only convert to Number at
 * the very edge, by dividing the integer string safely (never `Number(bigint)`
 * on values that could exceed 2^53 before scaling — these stay well within
 * range after scaling, but we still go through BigInt division for the integer
 * part and keep the fractional remainder exact).
 */

export const EM_DASH = "—";

const FP_ONE = 100_000_000n; // 1e8 fixed-point

/** Parse a possibly-undefined integer string into a BigInt; null on failure. */
export function toBigIntOrNull(v: string | null | undefined): bigint | null {
  if (v === null || v === undefined || v === "") return null;
  try {
    return BigInt(v);
  } catch {
    return null;
  }
}

/**
 * Format a fixed-decimal integer (BigInt) as a decimal string with a chosen
 * number of visible fraction digits. Exact: no float math on the raw amount.
 */
function formatFixed(amount: bigint, decimals: number, displayDecimals: number, group = false): string {
  const neg = amount < 0n;
  let a = neg ? -amount : amount;
  const scale = 10n ** BigInt(decimals);
  const intPart = a / scale;
  const fracPart = a % scale;

  // fractional string padded to `decimals`, then trimmed/truncated to display
  let fracStr = fracPart.toString().padStart(decimals, "0");
  if (displayDecimals < decimals) {
    fracStr = fracStr.slice(0, displayDecimals);
  } else if (displayDecimals > decimals) {
    fracStr = fracStr.padEnd(displayDecimals, "0");
  }

  let intStr = intPart.toString();
  if (group) intStr = groupThousands(intStr);

  const sign = neg ? "-" : "";
  if (displayDecimals === 0) return `${sign}${intStr}`;
  return `${sign}${intStr}.${fracStr}`;
}

function groupThousands(s: string): string {
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** sats (8 decimals) -> e.g. "1.2500" sBTC value string (no unit). */
export function formatSats(sats: bigint | string | null | undefined, displayDecimals = 4): string {
  const b = typeof sats === "bigint" ? sats : toBigIntOrNull(sats ?? null);
  if (b === null) return EM_DASH;
  return formatFixed(b, 8, displayDecimals);
}

/** micro-USDC (6 decimals) -> "1,234.56" string (no unit). */
export function formatUsdc(micro: bigint | string | null | undefined, displayDecimals = 2): string {
  const b = typeof micro === "bigint" ? micro : toBigIntOrNull(micro ?? null);
  if (b === null) return EM_DASH;
  return formatFixed(b, 6, displayDecimals, true);
}

/** A plain USD number -> "$1,234" (rounded) or with cents. */
export function formatUsd(value: number | null | undefined, opts?: { cents?: boolean; compact?: boolean }): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EM_DASH;
  const cents = opts?.cents ?? false;
  if (opts?.compact && Math.abs(value) >= 1000) {
    return "$" + compactNumber(value);
  }
  const fixed = value.toFixed(cents ? 2 : 0);
  const [int, frac] = fixed.split(".");
  const grouped = groupThousands(int.replace("-", ""));
  const sign = value < 0 ? "-" : "";
  return `${sign}$${grouped}${frac ? "." + frac : ""}`;
}

function compactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return (value / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return (value / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return (value / 1e3).toFixed(1) + "k";
  return value.toFixed(0);
}

/** A fraction like 0.238 -> "23.8%". null -> em-dash. */
export function formatPct(fraction: number | null | undefined, digits = 1): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return EM_DASH;
  return (fraction * 100).toFixed(digits) + "%";
}

/** A USD 1e8 fixed-point string -> plain USD number string "$112,500". */
export function formatUsdFp(fp: string | bigint | null | undefined, opts?: { cents?: boolean }): string {
  const b = typeof fp === "bigint" ? fp : toBigIntOrNull(fp ?? null);
  if (b === null) return EM_DASH;
  const cents = opts?.cents ?? false;
  // exact integer-dollar part; fractional cents from remainder
  const neg = b < 0n;
  const a = neg ? -b : b;
  const dollars = a / FP_ONE;
  const grouped = groupThousands(dollars.toString());
  const sign = neg ? "-" : "";
  if (!cents) return `${sign}$${grouped}`;
  const centsPart = ((a % FP_ONE) * 100n) / FP_ONE;
  return `${sign}$${grouped}.${centsPart.toString().padStart(2, "0")}`;
}

/**
 * Parse a user-typed decimal string into base integer units (BigInt) at the
 * given number of decimals. Returns null for invalid/empty input. Exact — no
 * float rounding (we pad/truncate the fractional digits directly).
 */
export function parseDecimalToBase(input: string, decimals: number): bigint | null {
  const t = input.trim();
  if (!t) return null;
  if (!/^\d*\.?\d*$/.test(t) || t === ".") return null;
  const [intPart = "0", fracRaw = ""] = t.split(".");
  const frac = (fracRaw + "0".repeat(decimals)).slice(0, decimals);
  try {
    const scale = 10n ** BigInt(decimals);
    return BigInt(intPart || "0") * scale + BigInt(frac || "0");
  } catch {
    return null;
  }
}

/** Truncate a Stacks address to "ST2C…9AG" form. */
export function truncateAddress(addr: string | null | undefined, lead = 4, tail = 3): string {
  if (!addr) return EM_DASH;
  if (addr.length <= lead + tail + 1) return addr;
  return `${addr.slice(0, lead)}…${addr.slice(-tail)}`;
}

/**
 * Countdown from now to a unix-seconds timestamp.
 * Returns "2d 04:13:09" style; "expired" when past; em-dash when no target.
 */
export function formatCountdown(expiryUnix: number | null | undefined, nowMs = Date.now()): string {
  if (expiryUnix === null || expiryUnix === undefined || !Number.isFinite(expiryUnix)) return EM_DASH;
  let secs = Math.floor(expiryUnix - nowMs / 1000);
  if (secs <= 0) return "expired";
  const days = Math.floor(secs / 86400);
  secs -= days * 86400;
  const hours = Math.floor(secs / 3600);
  secs -= hours * 3600;
  const mins = Math.floor(secs / 60);
  secs -= mins * 60;
  const hh = String(hours).padStart(2, "0");
  const mm = String(mins).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");
  if (days > 0) return `${days}d ${hh}:${mm}:${ss}`;
  return `${hh}:${mm}:${ss}`;
}
