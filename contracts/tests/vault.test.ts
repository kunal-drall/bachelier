/**
 * Full vault lifecycle. Tests in this file run sequentially and share chain
 * state on purpose: they walk three rounds end-to-end (OTM, ITM, and a
 * permissionless-settle round) with exact-value assertions throughout.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { Cl, cvToJSON, serializeCV } from "@stacks/transactions";
import { decodeVaultEvent } from "@bachelier/shared/events";
import {
  deployer, alice, bob, carol, dave, eve, VAULT,
  ONE, SPOT,
  ok, err, prints, nowRo, setPrice, mineUntil,
  sbtcBalance, usdcBalance, shareBalance,
  vaultState, getRound, getUser, getPosition, bootstrap, bsCallPriceFp,
} from "./helpers";

const ROUND_LEN = 604_800n; // real 7-day rounds (simnet mines a week in ms)
const GRACE = 1200n;
const IV = 55_000_000n; // 0.55
const RATE = 4_000_000n; // 0.04
const SECONDS_PER_YEAR = 31_536_000n;
const STRIKE_10 = (SPOT * 11000n) / 10000n; // +10% OTM

function expectSolvent() {
  const s = vaultState();
  expect(sbtcBalance(VAULT)).toBe(BigInt(s["total-collateral-sbtc"]) + BigInt(s["reserved-payout-sbtc"]));
}

/**
 * Assert a buy-call tx charged the exact on-chain Black-Scholes premium:
 * reproduce the price from the pricing inputs recorded in the event.
 */
function assertPremiumExact(res: any, contracts: bigint): bigint {
  const ev = prints(res).find((p) => p.e === "call-bought");
  expect(ev, "call-bought event missing").toBeTruthy();
  const usd = bsCallPriceFp(BigInt(ev.spot), BigInt(ev.strike), IV, BigInt(ev["t-fp"]), RATE);
  const expected = (usd / 100n) * contracts;
  expect(BigInt(ev.premium)).toBe(expected);
  expect(BigInt(ev.contracts)).toBe(contracts);
  // tenor recorded must equal expiry - (time the tx observed)
  const round = getRound(Number(ev.round));
  const tSeen = nowRo(); // == parent-block time the tx read
  expect(BigInt(ev["t-fp"])).toBe(((BigInt(round.expiry) - tSeen) * ONE) / SECONDS_PER_YEAR);
  return expected;
}

beforeAll(() => {
  bootstrap();
  ok(
    simnet.callPublicFn(
      "vault",
      "set-config",
      [
        Cl.uint(100_000n), // min-deposit 0.001 sBTC
        Cl.uint(100n),
        Cl.uint(5000n),
        Cl.uint(10_000_000n),
        Cl.uint(300_000_000n),
        Cl.uint(ROUND_LEN),
        Cl.uint(GRACE),
        Cl.int(RATE),
      ],
      deployer
    )
  );
});

describe("vault: deposits and shares", () => {
  it("first deposit mints shares 1:1 and emits a decodable event", () => {
    const res = simnet.callPublicFn("vault", "deposit", [Cl.uint(5n * ONE), Cl.contractPrincipal(deployer, "sbtc-token")], alice);
    expect(ok(res)).toBe(5n * ONE);
    expect(shareBalance(alice)).toBe(5n * ONE);

    const s = vaultState();
    expect(BigInt(s["total-collateral-sbtc"])).toBe(5n * ONE);
    expect(BigInt(s["total-shares"])).toBe(5n * ONE);
    expect(BigInt(s["share-price"])).toBe(ONE);

    // the print event round-trips through the shared decoder
    const ev = res.events.filter((e: any) => e.event === "print_event").map((e: any) => {
      const hex = serializeCV(e.data.value);
      return decodeVaultEvent(typeof hex === "string" ? hex : Buffer.from(hex).toString("hex"));
    }).find((e: any) => e?.e === "deposit") as any;
    expect(ev).toBeTruthy();
    expect(ev.user).toBe(alice);
    expect(ev.amount).toBe(5n * ONE);
    expect(ev.shares).toBe(5n * ONE);
    expectSolvent();
  });

  it("second deposit is pro-rata", () => {
    const res = simnet.callPublicFn("vault", "deposit", [Cl.uint(3n * ONE), Cl.contractPrincipal(deployer, "sbtc-token")], bob);
    expect(ok(res)).toBe(3n * ONE);
    expect(BigInt(vaultState()["total-shares"])).toBe(8n * ONE);
    expectSolvent();
  });

  it("rejects deposits below the minimum (u101)", () => {
    err(simnet.callPublicFn("vault", "deposit", [Cl.uint(50_000n), Cl.contractPrincipal(deployer, "sbtc-token")], alice), 101);
  });

  it("rejects a wrong token principal (u112)", () => {
    err(simnet.callPublicFn("vault", "deposit", [Cl.uint(ONE), Cl.contractPrincipal(deployer, "usdc-token")], alice), 112);
  });

  it("pause blocks deposits (u100), unpause restores", () => {
    ok(simnet.callPublicFn("vault", "pause", [], deployer));
    err(simnet.callPublicFn("vault", "deposit", [Cl.uint(ONE), Cl.contractPrincipal(deployer, "sbtc-token")], alice), 100);
    ok(simnet.callPublicFn("vault", "unpause", [], deployer));
  });
});

describe("vault: round lifecycle and access control", () => {
  it("non-keeper cannot start a round (u107); non-owner cannot administrate (u108)", () => {
    err(simnet.callPublicFn("vault", "start-round", [Cl.uint(1000n), Cl.uint(IV)], alice), 107);
    err(simnet.callPublicFn("vault", "set-keeper", [Cl.principal(alice)], alice), 108);
    err(simnet.callPublicFn("vault", "pause", [], alice), 108);
    err(simnet.callPublicFn("vault", "set-config", [Cl.uint(1n), Cl.uint(1n), Cl.uint(2n), Cl.uint(1n), Cl.uint(2n), Cl.uint(60n), Cl.uint(0n), Cl.int(0n)], alice), 108);
  });

  it("rejects out-of-bounds round parameters (u119)", () => {
    err(simnet.callPublicFn("vault", "start-round", [Cl.uint(50n), Cl.uint(IV)], deployer), 119); // otm < min
    err(simnet.callPublicFn("vault", "start-round", [Cl.uint(9000n), Cl.uint(IV)], deployer), 119); // otm > max
    err(simnet.callPublicFn("vault", "start-round", [Cl.uint(1000n), Cl.uint(5_000_000n)], deployer), 119); // iv < min
  });

  it("keeper opens round 1 at strike = spot * 1.10", () => {
    const res = simnet.callPublicFn("vault", "start-round", [Cl.uint(1000n), Cl.uint(IV)], deployer);
    expect(ok(res)).toBe(1n);

    const round = getRound(1);
    expect(BigInt(round.status)).toBe(1n);
    expect(BigInt(round.strike)).toBe(STRIKE_10);
    expect(BigInt(round.iv)).toBe(IV);
    expect(BigInt(round["spot-open"])).toBe(SPOT);
    // opened-at is the time the tx observed (== parent block, readable now)
    expect(BigInt(round["opened-at"])).toBe(nowRo());
    expect(BigInt(round.expiry)).toBe(BigInt(round["opened-at"]) + ROUND_LEN);
    expect(BigInt(round["contracts-written"])).toBe(0n);

    const ev = prints(res).find((p) => p.e === "round-started");
    expect(ev).toBeTruthy();
    expect(BigInt(ev.strike)).toBe(STRIKE_10);
  });

  it("cannot start a second round while one is active (u102)", () => {
    err(simnet.callPublicFn("vault", "start-round", [Cl.uint(1000n), Cl.uint(IV)], deployer), 102);
  });
});

describe("vault: buying calls", () => {
  it("buy-call charges the exact on-chain Black-Scholes premium", () => {
    const carolBefore = usdcBalance(carol);

    const res = simnet.callPublicFn("vault", "buy-call", [Cl.uint(2n), Cl.contractPrincipal(deployer, "usdc-token")], carol);
    const paid = ok(res) as bigint;
    const expected = assertPremiumExact(res, 2n);
    expect(paid).toBe(expected);
    expect(usdcBalance(carol)).toBe(carolBefore - expected);
    expect(usdcBalance(VAULT)).toBe(expected);

    const round = getRound(1);
    expect(BigInt(round["contracts-written"])).toBe(2n);
    expect(BigInt(round["premium-collected"])).toBe(expected);

    const pos = getPosition(1, carol);
    expect(BigInt(pos.contracts)).toBe(2n);
    expect(BigInt(pos["premium-paid"])).toBe(expected);

    // premium accrues to depositors pro-rata immediately (alice 5/8, bob 3/8)
    const aliceClaim = BigInt(getUser(alice)["claimable-premium-usdc"]);
    const acc = (expected * 1_000_000_000_000n) / (8n * ONE);
    expect(aliceClaim).toBe((5n * ONE * acc) / 1_000_000_000_000n);

    // sanity: the reference economics hold (~$430/contract premium at +10% OTM)
    const perContract = Number(paid / 2n) / 1e6;
    expect(perContract).toBeGreaterThan(380);
    expect(perContract).toBeLessThan(470);
    expectSolvent();
  });

  it("cannot buy more than coverage (u106) or zero (u113)", () => {
    err(simnet.callPublicFn("vault", "buy-call", [Cl.uint(7n), Cl.contractPrincipal(deployer, "usdc-token")], dave), 106);
    err(simnet.callPublicFn("vault", "buy-call", [Cl.uint(0n), Cl.contractPrincipal(deployer, "usdc-token")], dave), 113);
  });
});

describe("vault: withdrawals while a round is active", () => {
  it("idle collateral can be withdrawn", () => {
    const res = simnet.callPublicFn("vault", "withdraw", [Cl.uint(ONE), Cl.contractPrincipal(deployer, "sbtc-token")], alice);
    expect(ok(res)).toBe(ONE); // share price still 1.0
    expect(BigInt(vaultState()["total-collateral-sbtc"])).toBe(7n * ONE);
    expectSolvent();
  });

  it("request-withdraw excludes queued collateral from new writes", () => {
    ok(simnet.callPublicFn("vault", "request-withdraw", [Cl.uint(2n * ONE)], alice));
    // 7 sBTC total, 2 written, 2 queued -> only 3 more writable
    expect(BigInt(vaultState()["contracts-available"])).toBe(3n);
    err(simnet.callPublicFn("vault", "buy-call", [Cl.uint(4n), Cl.contractPrincipal(deployer, "usdc-token")], dave), 106);

    const res = simnet.callPublicFn("vault", "buy-call", [Cl.uint(3n), Cl.contractPrincipal(deployer, "usdc-token")], dave);
    expect(ok(res)).toBe(assertPremiumExact(res, 3n));
    expect(BigInt(getRound(1)["contracts-written"])).toBe(5n);
  });

  it("withdrawals beyond idle are locked until settlement (u115)", () => {
    // 7 sBTC collateral, 5 contracts written -> idle 2 sBTC
    err(simnet.callPublicFn("vault", "withdraw", [Cl.uint(3n * ONE), Cl.contractPrincipal(deployer, "sbtc-token")], bob), 115);
    const res = simnet.callPublicFn("vault", "withdraw", [Cl.uint(2n * ONE), Cl.contractPrincipal(deployer, "sbtc-token")], bob);
    expect(ok(res)).toBe(2n * ONE);
    // now fully locked: even 1 share cannot leave
    err(simnet.callPublicFn("vault", "withdraw", [Cl.uint(1n), Cl.contractPrincipal(deployer, "sbtc-token")], alice), 115);
    expectSolvent();
  });
});

describe("vault: round 1 settles OTM", () => {
  it("cannot settle before expiry (u105); cannot buy after expiry (u104)", () => {
    err(simnet.callPublicFn("vault", "settle-round", [], deployer), 105);
    mineUntil(BigInt(getRound(1).expiry));
    err(simnet.callPublicFn("vault", "buy-call", [Cl.uint(1n), Cl.contractPrincipal(deployer, "usdc-token")], carol), 104);
  });

  it("rejects settlement with a price published before expiry (u122)", () => {
    // price publish-time is still pre-expiry from the last set
    err(simnet.callPublicFn("vault", "settle-round", [], deployer), 122);
  });

  it("settles worthless: pool keeps all sBTC and all premium", () => {
    const expiry = BigInt(getRound(1).expiry);
    setPrice(SPOT, expiry + 1n); // S_exp = spot < strike
    const collBefore = BigInt(vaultState()["total-collateral-sbtc"]);
    const premBefore = BigInt(vaultState()["premium-pool-usdc"]);

    const res = simnet.callPublicFn("vault", "settle-round", [], deployer);
    const out = ok(res) as any;
    expect(BigInt(out["sbtc-paid-out"])).toBe(0n);

    const round = getRound(1);
    expect(BigInt(round.status)).toBe(2n);
    expect(BigInt(round["payout-per-contract"])).toBe(0n);
    expect(BigInt(vaultState()["total-collateral-sbtc"])).toBe(collBefore);
    expect(BigInt(vaultState()["premium-pool-usdc"])).toBe(premBefore);

    // nothing to exercise on an OTM round
    err(simnet.callPublicFn("vault", "exercise", [Cl.uint(1n), Cl.contractPrincipal(deployer, "sbtc-token")], carol), 120);
    expectSolvent();
  });

  it("queued withdrawal executes after settlement and clears the queue", () => {
    expect(BigInt(vaultState()["total-queued-shares"])).toBe(2n * ONE);
    const res = simnet.callPublicFn("vault", "withdraw", [Cl.uint(2n * ONE), Cl.contractPrincipal(deployer, "sbtc-token")], alice);
    expect(ok(res)).toBe(2n * ONE);
    expect(BigInt(vaultState()["total-queued-shares"])).toBe(0n);
    expectSolvent();
  });

  it("depositors claim premium pro-rata; double-claim rejected (u120)", () => {
    const totalPremium = BigInt(getRound(1)["premium-collected"]);
    const aliceExpected = BigInt(getUser(alice)["claimable-premium-usdc"]);
    const bobExpected = BigInt(getUser(bob)["claimable-premium-usdc"]);

    const a = simnet.callPublicFn("vault", "claim-premium", [Cl.contractPrincipal(deployer, "usdc-token")], alice);
    expect(ok(a)).toBe(aliceExpected);
    expect(usdcBalance(alice)).toBe(aliceExpected);

    const b = simnet.callPublicFn("vault", "claim-premium", [Cl.contractPrincipal(deployer, "usdc-token")], bob);
    expect(ok(b)).toBe(bobExpected);

    // conservation: claims + dust-left-in-pool == premium collected
    const poolLeft = BigInt(vaultState()["premium-pool-usdc"]);
    expect(aliceExpected + bobExpected + poolLeft).toBe(totalPremium);
    expect(poolLeft).toBeLessThan(10n); // index floor dust only

    err(simnet.callPublicFn("vault", "claim-premium", [Cl.contractPrincipal(deployer, "usdc-token")], alice), 120);
  });
});

describe("vault: round 2 settles ITM", () => {
  it("opens round 2 and sells 2 contracts", () => {
    setPrice(SPOT);
    ok(simnet.callPublicFn("vault", "start-round", [Cl.uint(1000n), Cl.uint(IV)], deployer));
    expect(BigInt(vaultState()["current-round"])).toBe(2n);
    const res = simnet.callPublicFn("vault", "buy-call", [Cl.uint(2n), Cl.contractPrincipal(deployer, "usdc-token")], carol);
    expect(ok(res)).toBe(assertPremiumExact(res, 2n));
  });

  it("settles in the money: buyers get (S-K)/S per contract, vault stays solvent", () => {
    const round = getRound(2);
    const expiry = BigInt(round.expiry);
    const strike = BigInt(round.strike);
    mineUntil(expiry);

    // S_exp = 1.25 * K -> payout fraction exactly 0.2 sBTC per contract
    const sExp = (strike * 5n) / 4n;
    setPrice(sExp, expiry + 1n);

    const collBefore = BigInt(vaultState()["total-collateral-sbtc"]);
    const res = simnet.callPublicFn("vault", "settle-round", [], deployer);
    const out = ok(res) as any;

    const ppc = 20_000_000n; // 0.2 sBTC in sats
    expect(BigInt(out["sbtc-paid-out"])).toBe(2n * ppc);
    expect(BigInt(getRound(2)["payout-per-contract"])).toBe(ppc);
    expect(BigInt(vaultState()["total-collateral-sbtc"])).toBe(collBefore - 2n * ppc);
    expect(BigInt(vaultState()["reserved-payout-sbtc"])).toBe(2n * ppc);
    expectSolvent();
  });

  it("buyer exercises once (u117 on retry); strangers have no position (u116)", () => {
    const before = sbtcBalance(carol);
    const res = simnet.callPublicFn("vault", "exercise", [Cl.uint(2n), Cl.contractPrincipal(deployer, "sbtc-token")], carol);
    expect(ok(res)).toBe(40_000_000n);
    expect(sbtcBalance(carol)).toBe(before + 40_000_000n);
    expect(BigInt(vaultState()["reserved-payout-sbtc"])).toBe(0n);

    err(simnet.callPublicFn("vault", "exercise", [Cl.uint(2n), Cl.contractPrincipal(deployer, "sbtc-token")], carol), 117);
    err(simnet.callPublicFn("vault", "exercise", [Cl.uint(2n), Cl.contractPrincipal(deployer, "sbtc-token")], dave), 116);
    expectSolvent();
  });

  it("share price reflects the capped upside (ITM loss in sBTC terms)", () => {
    const s = vaultState();
    const sharePrice = BigInt(s["share-price"]);
    expect(sharePrice).toBeLessThan(ONE);
    // bob exits at the marked-down price
    const bobShares = shareBalance(bob);
    const expectedOut = (bobShares * BigInt(s["total-collateral-sbtc"])) / BigInt(s["total-shares"]);
    const res = simnet.callPublicFn("vault", "withdraw", [Cl.uint(bobShares), Cl.contractPrincipal(deployer, "sbtc-token")], bob);
    expect(ok(res)).toBe(expectedOut);
    expectSolvent();
  });
});

describe("vault: permissionless settlement after grace", () => {
  it("non-keeper settles only after the grace window", () => {
    // widen grace so the 600s block cadence cannot skip past it
    ok(
      simnet.callPublicFn(
        "vault",
        "set-config",
        [Cl.uint(100_000n), Cl.uint(100n), Cl.uint(5000n), Cl.uint(10_000_000n), Cl.uint(300_000_000n), Cl.uint(ROUND_LEN), Cl.uint(3000n), Cl.int(RATE)],
        deployer
      )
    );
    setPrice(SPOT);
    ok(simnet.callPublicFn("vault", "deposit", [Cl.uint(2n * ONE), Cl.contractPrincipal(deployer, "sbtc-token")], alice));
    ok(simnet.callPublicFn("vault", "start-round", [Cl.uint(1000n), Cl.uint(IV)], deployer));

    const expiry = BigInt(getRound(3).expiry);
    mineUntil(expiry);
    setPrice(SPOT, expiry + 1n);

    // within grace: only the keeper may settle
    err(simnet.callPublicFn("vault", "settle-round", [], carol), 121);
    mineUntil(expiry + 3000n);
    ok(simnet.callPublicFn("vault", "settle-round", [], carol));
    expect(BigInt(getRound(3).status)).toBe(2n);
    expectSolvent();
  });
});

describe("vault: share transfers and token authorization", () => {
  it("direct bcSHARE transfers are rejected (u401); vault.transfer-shares works", () => {
    err(
      simnet.callPublicFn(
        "bcshare-token",
        "transfer",
        [Cl.uint(1000n), Cl.principal(alice), Cl.principal(eve), Cl.none()],
        alice
      ),
      401
    );

    const amount = 50_000_000n;
    const aliceBefore = shareBalance(alice);
    ok(simnet.callPublicFn("vault", "transfer-shares", [Cl.uint(amount), Cl.principal(eve)], alice));
    expect(shareBalance(alice)).toBe(aliceBefore - amount);
    expect(shareBalance(eve)).toBe(amount);

    // recipient starts with a clean premium checkpoint: nothing claimable
    expect(BigInt(getUser(eve)["claimable-premium-usdc"])).toBe(0n);

    // and can withdraw their share of collateral
    const s = vaultState();
    const expectedOut = (amount * BigInt(s["total-collateral-sbtc"])) / BigInt(s["total-shares"]);
    const res = simnet.callPublicFn("vault", "withdraw", [Cl.uint(amount), Cl.contractPrincipal(deployer, "sbtc-token")], eve);
    expect(ok(res)).toBe(expectedOut);
    expectSolvent();
  });

  it("set-tokens is blocked once shares exist (u119)", () => {
    err(
      simnet.callPublicFn(
        "vault",
        "set-tokens",
        [Cl.contractPrincipal(deployer, "sbtc-token"), Cl.contractPrincipal(deployer, "usdc-token")],
        deployer
      ),
      119
    );
  });

  it("final conservation: vault token balances equal internal accounting", () => {
    const s = vaultState();
    expect(sbtcBalance(VAULT)).toBe(BigInt(s["total-collateral-sbtc"]) + BigInt(s["reserved-payout-sbtc"]));
    expect(usdcBalance(VAULT)).toBe(BigInt(s["premium-pool-usdc"]));
    // supply equals the sum of all holder balances
    const holders = [alice, bob, carol, dave, eve, deployer];
    const sum = holders.reduce((acc, h) => acc + shareBalance(h), 0n);
    expect(sum).toBe(BigInt(s["total-shares"]));
  });
});
