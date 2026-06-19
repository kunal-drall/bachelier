import { describe, expect, it } from "vitest";
import { Cl, cvToJSON } from "@stacks/transactions";
import { deployer, alice, bob, VAULT, err, ok } from "./helpers";

describe("bcshare-token authorization", () => {
  it("exposes SIP-010 metadata", () => {
    const name = cvToJSON(simnet.callReadOnlyFn("bcshare-token", "get-name", [], deployer).result);
    expect(name.value.value).toBe("Bachelier Share");
    const dec = cvToJSON(simnet.callReadOnlyFn("bcshare-token", "get-decimals", [], deployer).result);
    expect(BigInt(dec.value.value)).toBe(8n);
    const sym = cvToJSON(simnet.callReadOnlyFn("bcshare-token", "get-symbol", [], deployer).result);
    expect(sym.value.value).toBe("bcSHARE");
  });

  it("set-vault is owner-only (u401)", () => {
    err(simnet.callPublicFn("bcshare-token", "set-vault", [Cl.principal(VAULT)], alice), 401);
    ok(simnet.callPublicFn("bcshare-token", "set-vault", [Cl.principal(VAULT)], deployer));
    const v = cvToJSON(simnet.callReadOnlyFn("bcshare-token", "get-vault", [], deployer).result);
    expect(v.value).toBe(VAULT);
  });

  it("mint, burn, and transfer are vault-only (u401)", () => {
    err(simnet.callPublicFn("bcshare-token", "mint", [Cl.uint(1000n), Cl.principal(alice)], deployer), 401);
    err(simnet.callPublicFn("bcshare-token", "mint", [Cl.uint(1000n), Cl.principal(alice)], alice), 401);
    err(simnet.callPublicFn("bcshare-token", "burn", [Cl.uint(1000n), Cl.principal(alice)], alice), 401);
    err(
      simnet.callPublicFn(
        "bcshare-token",
        "transfer",
        [Cl.uint(1n), Cl.principal(alice), Cl.principal(bob), Cl.none()],
        alice
      ),
      401
    );
  });
});
