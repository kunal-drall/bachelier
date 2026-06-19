import { describe, expect, it } from "vitest";
import { Cl, serializeCV } from "@stacks/transactions";
import { decodeVaultEvent } from "../src/events.js";

function hexOf(tuple: Record<string, any>): string {
  const s = serializeCV(Cl.tuple(tuple));
  return typeof s === "string" ? s : Buffer.from(s).toString("hex");
}

describe("decodeVaultEvent", () => {
  it("round-trips a deposit print", () => {
    const hex = hexOf({
      e: Cl.stringAscii("deposit"),
      user: Cl.principal("ST1SJ3DTE5DN7X54YDH5D64R3BCB6A2AG2ZQ8YPD5"),
      amount: Cl.uint(500_000_000n),
      shares: Cl.uint(500_000_000n),
      round: Cl.uint(0n),
    });
    const ev = decodeVaultEvent(hex);
    expect(ev).toEqual({
      e: "deposit",
      user: "ST1SJ3DTE5DN7X54YDH5D64R3BCB6A2AG2ZQ8YPD5",
      amount: 500_000_000n,
      shares: 500_000_000n,
      round: 0n,
    });
  });

  it("round-trips a call-bought print incl. the pricing tenor", () => {
    const hex = hexOf({
      e: Cl.stringAscii("call-bought"),
      round: Cl.uint(1n),
      buyer: Cl.principal("ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG"),
      contracts: Cl.uint(2n),
      premium: Cl.uint(860_000_000n),
      strike: Cl.int(11_463_100_000_000n),
      spot: Cl.int(10_421_000_000_000n),
      "t-fp": Cl.uint(1_915_905n),
    });
    const ev = decodeVaultEvent(hex);
    expect(ev).toMatchObject({ e: "call-bought", contracts: 2n, tFp: 1_915_905n });
  });

  it("returns null for non-bachelier prints", () => {
    expect(decodeVaultEvent(hexOf({ foo: Cl.uint(1n) }))).toBeNull();
  });
});
