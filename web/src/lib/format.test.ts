// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  formatSats,
  formatUsdc,
  formatUsd,
  formatUsdFp,
  formatPct,
  truncateAddress,
  formatCountdown,
  parseDecimalToBase,
  toBigIntOrNull,
  EM_DASH,
} from "./format";

describe("formatSats", () => {
  it("formats sats (8dp) to sBTC string", () => {
    expect(formatSats("125000000")).toBe("1.2500");
    expect(formatSats("100000000")).toBe("1.0000");
    expect(formatSats("12345678", 8)).toBe("0.12345678");
    expect(formatSats(0n)).toBe("0.0000");
  });
  it("returns em-dash for null/invalid", () => {
    expect(formatSats(null)).toBe(EM_DASH);
    expect(formatSats(undefined)).toBe(EM_DASH);
    expect(formatSats("not-a-number")).toBe(EM_DASH);
  });
});

describe("formatUsdc", () => {
  it("formats micro-USDC (6dp) with thousands grouping", () => {
    expect(formatUsdc("1234560000")).toBe("1,234.56");
    expect(formatUsdc("1000000")).toBe("1.00");
    expect(formatUsdc("430000000")).toBe("430.00");
  });
  it("returns em-dash for null", () => {
    expect(formatUsdc(null)).toBe(EM_DASH);
  });
});

describe("formatUsd", () => {
  it("formats plain USD numbers", () => {
    expect(formatUsd(112500)).toBe("$112,500");
    expect(formatUsd(430)).toBe("$430");
    expect(formatUsd(430.27, { cents: true })).toBe("$430.27");
  });
  it("handles null/NaN", () => {
    expect(formatUsd(null)).toBe(EM_DASH);
    expect(formatUsd(NaN)).toBe(EM_DASH);
  });
});

describe("formatUsdFp", () => {
  it("formats a 1e8 fixed-point USD string", () => {
    // 112500 * 1e8
    expect(formatUsdFp("11250000000000")).toBe("$112,500");
    expect(formatUsdFp("11250050000000", { cents: true })).toBe("$112,500.50");
  });
});

describe("formatPct", () => {
  it("formats a fraction as a percentage", () => {
    expect(formatPct(0.238)).toBe("23.8%");
    expect(formatPct(0.05)).toBe("5.0%");
    expect(formatPct(null)).toBe(EM_DASH);
  });
});

describe("truncateAddress", () => {
  it("truncates Stacks addresses", () => {
    expect(truncateAddress("ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG")).toBe("ST2C…9AG");
    expect(truncateAddress("ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG", 4, 4)).toBe("ST2C…K9AG");
  });
  it("returns em-dash for empty", () => {
    expect(truncateAddress(null)).toBe(EM_DASH);
  });
});

describe("formatCountdown", () => {
  const now = 1_700_000_000_000; // fixed ms
  it("formats a future timestamp as d hh:mm:ss", () => {
    const target = now / 1000 + 2 * 86400 + 4 * 3600 + 13 * 60 + 9;
    expect(formatCountdown(target, now)).toBe("2d 04:13:09");
  });
  it("omits days under 24h", () => {
    const target = now / 1000 + 3 * 3600 + 5 * 60 + 1;
    expect(formatCountdown(target, now)).toBe("03:05:01");
  });
  it("returns 'expired' for past timestamps", () => {
    expect(formatCountdown(now / 1000 - 10, now)).toBe("expired");
  });
  it("returns em-dash for null", () => {
    expect(formatCountdown(null, now)).toBe(EM_DASH);
  });
});

describe("parseDecimalToBase", () => {
  it("parses decimals to base units exactly", () => {
    expect(parseDecimalToBase("1.25", 8)).toBe(125_000_000n);
    expect(parseDecimalToBase("0.00000001", 8)).toBe(1n);
    expect(parseDecimalToBase("10", 6)).toBe(10_000_000n);
    // truncates beyond precision (no rounding)
    expect(parseDecimalToBase("1.234567891", 8)).toBe(123_456_789n);
  });
  it("rejects invalid input", () => {
    expect(parseDecimalToBase("", 8)).toBeNull();
    expect(parseDecimalToBase(".", 8)).toBeNull();
    expect(parseDecimalToBase("abc", 8)).toBeNull();
  });
});

describe("toBigIntOrNull", () => {
  it("parses integer strings", () => {
    expect(toBigIntOrNull("42")).toBe(42n);
    expect(toBigIntOrNull(null)).toBeNull();
    expect(toBigIntOrNull("x")).toBeNull();
  });
});
