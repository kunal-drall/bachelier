import { Cl, cvToJSON, ClarityValue } from "@stacks/transactions";
import { expect } from "vitest";
import { cvJsonToPlain } from "@bachelier/shared/events";

export const accounts = simnet.getAccounts();
export const deployer = accounts.get("deployer")!;
export const alice = accounts.get("wallet_1")!;
export const bob = accounts.get("wallet_2")!;
export const carol = accounts.get("wallet_3")!;
export const dave = accounts.get("wallet_4")!;
export const eve = accounts.get("wallet_5")!;

export const VAULT = `${deployer}.vault`;

/** simnet advances block time by a fixed 600s per mined block */
export const BLOCK_SECS = 600n;

export const ONE = 100_000_000n;
export const SPOT = 10_421_000_000_000n; // $104,210 * 1e8

export function ok(res: { result: ClarityValue }): any {
  const j = cvToJSON(res.result);
  expect(j.success, `expected ok, got ${JSON.stringify(j)}`).toBe(true);
  return cvJsonToPlain(j) as any;
}

export function err(res: { result: ClarityValue }, code: number | bigint): void {
  const j = cvToJSON(res.result);
  expect(j.success, `expected err u${code}, got ok: ${JSON.stringify(j)}`).toBe(false);
  expect(BigInt(j.value.value)).toBe(BigInt(code));
}

/** plain-object view of any CV (uses the shared decoder) */
export function plain(cv: ClarityValue): any {
  return cvJsonToPlain(cvToJSON(cv));
}

/** print events of a tx result, as plain objects */
export function prints(res: { events: any[] }): any[] {
  return res.events
    .filter((e) => e.event === "print_event")
    .map((e) => plain(e.data.value));
}

/**
 * Chain time as seen by read-only calls (parent block timestamp). A public
 * tx mined right after sees a time >= this; calling nowRo() again right
 * after that tx returns exactly the time the tx observed.
 */
export function nowRo(): bigint {
  const r = simnet.callReadOnlyFn("pyth-mock", "current-time", [], deployer);
  return BigInt(cvToJSON(r.result).value);
}

export function setPrice(price: bigint, publishTime?: bigint): void {
  const t = publishTime ?? nowRo();
  const r = simnet.callPublicFn("pyth-mock", "set-price", [Cl.int(price), Cl.uint(t)], deployer);
  ok(r);
}

export function mineUntil(targetTime: bigint): void {
  // per-block time advance varies (600s empty blocks, ~10s tx blocks), so
  // estimate, mine, and re-check until the chain time actually passes target
  for (let i = 0; i < 50; i++) {
    const t = nowRo();
    if (t >= targetTime) return;
    const blocks = Math.max(1, Number((targetTime - t) / BLOCK_SECS) + 1);
    simnet.mineEmptyBlocks(blocks);
  }
  throw new Error(`mineUntil: chain time never reached ${targetTime} (now ${nowRo()})`);
}

export function mintSbtc(to: string, sats: bigint): void {
  ok(simnet.callPublicFn("sbtc-token", "mint", [Cl.uint(sats), Cl.principal(to)], deployer));
}

export function mintUsdc(to: string, micro: bigint): void {
  ok(simnet.callPublicFn("usdc-token", "mint", [Cl.uint(micro), Cl.principal(to)], deployer));
}

export function sbtcBalance(who: string): bigint {
  const r = simnet.callReadOnlyFn("sbtc-token", "get-balance", [Cl.principal(who)], deployer);
  return BigInt(cvToJSON(r.result).value.value);
}

export function usdcBalance(who: string): bigint {
  const r = simnet.callReadOnlyFn("usdc-token", "get-balance", [Cl.principal(who)], deployer);
  return BigInt(cvToJSON(r.result).value.value);
}

export function shareBalance(who: string): bigint {
  const r = simnet.callReadOnlyFn("bcshare-token", "get-balance", [Cl.principal(who)], deployer);
  return BigInt(cvToJSON(r.result).value.value);
}

export function vaultState(): any {
  return plain(simnet.callReadOnlyFn("vault", "get-vault-state", [], deployer).result);
}

export function getRound(id: bigint | number): any {
  return plain(simnet.callReadOnlyFn("vault", "get-round", [Cl.uint(id)], deployer).result);
}

export function getUser(who: string): any {
  return plain(simnet.callReadOnlyFn("vault", "get-user", [Cl.principal(who)], deployer).result);
}

export function getPosition(round: bigint | number, buyer: string): any {
  return plain(
    simnet.callReadOnlyFn("vault", "get-position", [Cl.uint(round), Cl.principal(buyer)], deployer).result
  );
}

/** standard test bootstrap: wire bcshare to the vault, fund wallets, set price */
export function bootstrap(): void {
  ok(simnet.callPublicFn("bcshare-token", "set-vault", [Cl.principal(VAULT)], deployer));
  // generous staleness budget so multi-block tests don't trip ERR-STALE-PRICE
  ok(simnet.callPublicFn("oracle-adapter", "set-max-age", [Cl.uint(1_000_000n)], deployer));
  mintSbtc(alice, 20n * ONE);
  mintSbtc(bob, 20n * ONE);
  mintUsdc(carol, 5_000_000_000_000n); // 5,000,000 USDC
  mintUsdc(dave, 5_000_000_000_000n);
  setPrice(SPOT);
}

/** call bs-math.bs-call-price read-only (fp args) */
export function bsCallPriceFp(s: bigint, k: bigint, sigma: bigint, t: bigint, r: bigint): bigint {
  const res = simnet.callReadOnlyFn(
    "bs-math",
    "bs-call-price",
    [Cl.int(s), Cl.int(k), Cl.int(sigma), Cl.int(t), Cl.int(r)],
    deployer
  );
  const j = cvToJSON(res.result);
  expect(j.success).toBe(true);
  return BigInt(j.value.value);
}
