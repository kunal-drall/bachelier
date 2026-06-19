# Bachelier

A peer-to-pool **covered-call options vault on sBTC**, on Stacks — with options
**priced on-chain** by a fixed-point Black–Scholes engine written in Clarity.

Depositors add sBTC and receive **bcSHARE** pro-rata. Each weekly round the
keeper opens a slightly out-of-the-money strike from the Pyth BTC-USD oracle;
takers buy 1-sBTC call contracts and pay **USDC premium** that accrues to
depositors immediately via a premium-per-share index. At expiry the round
settles against the oracle:

- `S_exp ≤ K` — calls expire worthless. The pool keeps all sBTC **and** all premium.
- `S_exp > K` — each contract owes `(S_exp − K) / S_exp` sBTC (always < 1), paid
  out of collateral via pull-based `exercise`; the rest returns to the pool.

The pool can never write more contracts than whole sBTC it holds, so it is
**always fully collateralized** — settlement needs no external liquidity, and
premium only ever flows *in*.

**Reference economics** (asserted in tests at every layer): spot ≈ $104,210,
strike +10 %, IV 0.55, weekly tenor, r = 0.04 → **≈ $430 premium / contract ≈
0.41 %/week ≈ 23–24 % APY**.

```
                       ┌─────────────────────────────────────────┐
      Stacks (Clarity) │  oracle-adapter.clar ── reads ──► Pyth   │
                       │        │                                 │
                       │        ▼                                 │
 bs-math.clar ◄─ used by ─ vault.clar ◄── SIP-010 ── sBTC / USDC  │
 (fixed-point BS)      │  + bcshare-token (vault-gated SIP-010)   │
                       └───────────────┬───────────────┬──────────┘
                                       │ print events  │ read-onlys
                                       ▼               │
                       Chainhook ──► indexer (TS) ─────┤
                                       │ writes        │
                                       ▼               │
                                  Postgres (events_raw,│
                                  rounds, positions,   │
                                  snapshots, …)        │
                                       ▲               │
                                       │ reads         │
                                  api (Fastify) ◄──────┘
                                       ▲
                                       │ REST
                                  web (React + Vite)
                                  wallet writes ──► Stacks directly
                       keeper (TS) ── signs ──► start-round / settle-round
```

The browser signs all user-fund transactions via the wallet (Leather/Xverse).
The **only** server-side signer is the keeper, and it can only drive the round
lifecycle — it cannot touch user funds. The API is read-only.

## Repository layout

| path | what | tests |
|---|---|---|
| `contracts/` | Clarinet project: `bs-math`, `vault`, `oracle-adapter`, `bcshare-token`, devnet mocks | 78 vitest + clarinet-sdk tests incl. BS vector table, 216-point TS↔Clarity parity grid, full lifecycle both settlement branches, execution-cost gate |
| `packages/shared/` | BS TS mirror (`bs.ts`), fixed-point helpers, typed event decoders, network config, zod DTOs | parity exercised by contract + API suites |
| `db/` | Drizzle schema + migrations + seed (`pnpm --filter @bachelier/db seed`) | covered via indexer/API suites (PGlite) |
| `indexer/` | Chainhook webhook consumer → Postgres projections + snapshots; reorg rollback; Stacks-API backfill | 5 acceptance tests (replay, duplicate no-op, rollback/re-apply, resume) |
| `api/` | Fastify REST: `/vault`, `/vault/history`, `/rounds`, `/positions/:addr`, `/quote`, `/price`, `/tx/:txid`, `/health` | 13 tests, zod-validated, reference-economics gate |
| `keeper/` | Cron + tick worker: weekly `start-round`, post-expiry `settle-round`, devnet price relay, retries/backoff, `/health` | 7 policy + loop tests |
| `web/` | React + Vite app: landing + vault dApp, payoff canvas, wallet flows with post-conditions | 25 component/format tests |

## Quickstart (local devnet)

```bash
pnpm install

# 1. all tests (contracts + services + web)
pnpm test

# 2. start the chain (terminal A) — requires Docker
cd contracts && clarinet devnet start
# the deployment plan publishes all contracts and wires bcshare-token.set-vault

# 3. postgres + indexer + api (terminal B)
docker compose up postgres indexer api
# or natively:
#   docker compose up postgres -d
#   pnpm --filter @bachelier/db migrate && pnpm --filter @bachelier/db seed
#   pnpm --filter @bachelier/indexer dev   # :4001
#   pnpm --filter @bachelier/api dev       # :4000

# 4. chainhook predicate (devnet): indexer/chainhooks/vault-print.devnet.json
#    (clarinet devnet runs a chainhook node; point it at the indexer URL)

# 5. keeper (terminal C) — drives rounds; uses the devnet deployer key
cp .env.example .env   # uncomment KEEPER_PRIVATE_KEY (devnet deployer)
pnpm --filter @bachelier/keeper dev   # :4002

# 6. web (terminal D)
pnpm --filter @bachelier/web dev      # :5173  (VITE_API_URL=http://localhost:4000)
```

Every package reads `.env` / environment — see `.env.example` for the full
matrix. The web app shows a devnet **faucet** button (mock sBTC/USDC mints).

## The on-chain Black–Scholes engine (`contracts/contracts/bs-math.clar`)

All values are 8-decimal fixed point (`ONE = u100000000`); signed `int`
throughout with 128-bit headroom. Clarity has no loops, so:

- `fp-ln` — binary range reduction `x = 2^k·m`, `m ∈ [1,2)` via a `fold` over
  constant bit levels (64…1), then `2·atanh(u)` with 7 unrolled odd terms.
- `fp-exp` — `x = n·ln2 + y`, `y ∈ [0, ln2)`, 10-term unrolled Taylor (Horner),
  `2^n` by `pow`; negatives via `1/e^(−x)`; clamped at `e^66` against overflow.
- `fp-sqrt` — exact via `sqrti(x·ONE)`.
- `fp-normcdf` — Abramowitz–Stegun 7.1.26 with **the prototype's exact
  truncated coefficients**, so TS and Clarity agree term-for-term.
- `bs-call-price` — guards domain (`ERR-DOMAIN u1001`), returns `(ok price)`.

Parity gate: ≤ 0.05 % vs the TS mirror on the reference vectors and ≤ 0.1 %
across a 216-point grid (moneyness × vol × tenor × rate). Execution cost:
**`buy-call` ≈ 338 k runtime units ≈ 0.007 % of a block budget** (asserted in
`contracts/tests/costs.test.ts`).

## Vault error codes

`u100` paused · `u101` min deposit · `u102` round active · `u103` round not
active · `u104` expired · `u105` not expired · `u106` insufficient coverage ·
`u107` not keeper · `u108` not owner · `u109` stale price · `u110` bad price ·
`u111` transfer failed · `u112` wrong token · `u113` zero amount · `u114`
insufficient shares · `u115` locked by round · `u116` no position · `u117`
already claimed · `u118` not settled · `u119` bad params · `u120` nothing to
claim · `u121` settle in grace (keeper-only window) · `u122` settlement price
predates expiry · `u401` bcSHARE not authorized · `u1001` BS domain.

## Oracle wiring

`vault` only ever calls `oracle-adapter.get-btc-price`, which enforces
positivity (`u110`) and staleness vs `max-age` (`u109`); settlement further
requires `publish-time ≥ expiry` (`u122`). On devnet the adapter statically
reads `pyth-mock` (the keeper acts as relayer). For testnet/mainnet, swap the
adapter's inner call to the deployed Pyth contract
(`pyth-oracle-v3.get-price`, normalizing `expo` to 1e8) by pointing the
deployment plan's `oracle-adapter` entry at a Pyth-wired variant — the vault
and everything downstream stay unchanged.

## bcSHARE transferability

The token's balances **are** the vault's share ledger, so mint/burn/transfer
are gated on the vault contract, which harvests the premium index before any
balance change. Wallet-to-wallet moves go through `vault.transfer-shares`
(recipient starts with a clean premium checkpoint — verified in tests); direct
`bcshare-token.transfer` calls revert with `u401`.

## Testnet deployment runbook

1. `cp contracts/settings/Testnet.toml.example contracts/settings/Testnet.toml`,
   add your mnemonic (file is gitignored).
2. `cd contracts && clarinet deployments generate --testnet --medium-cost`,
   merge the wiring batch from `deployments/default.testnet-plan.yaml`
   (set-vault → set-price), then `clarinet deployments apply --testnet`.
3. Point the vault at real tokens **before the first deposit**:
   `vault.set-tokens(<sbtc>, <usdc>)` (owner-only, blocked once shares exist),
   and set the keeper: `vault.set-keeper(<keeper address>)`.
4. Record the deployer in env (`BACHELIER_DEPLOYER`, `BACHELIER_SBTC`, …) for
   indexer/api/keeper/web, register
   `indexer/chainhooks/vault-print.testnet.json` with your Chainhook node,
   deploy the three services (`docker/service.Dockerfile`), deploy `web/` to
   Vercel with `VITE_API_URL` + `VITE_STACKS_NETWORK=testnet`.
5. Post-deploy smoke: faucet/mint → `deposit` → keeper `start-round` →
   `buy-call` → settle after expiry (both branches exercised on devnet CI).

## Security checklist (enforced)

- Post-conditions on every user-facing token transfer (web builds them; the
  vault uses `try!`-guarded SIP-010 calls and canonical-token asserts `u112`).
- Oracle staleness + positivity guards; settlement price must postdate expiry.
- Pausable (`pause` blocks deposits/buys/round-starts; withdrawals, claims,
  settlement and exercise stay open — user-protective).
- Owner/keeper RBAC with events on every change; keeper key isolated in its
  own process/secret store, rotatable via `set-keeper`.
- Fixed-point overflow review: 128-bit headroom documented per operation;
  `fp-exp` clamped; division-before-zero guarded; cost-budget test.
- First-depositor inflation attack mitigated by `MIN_DEPOSIT` + internal
  collateral accounting (donations don't move the share price).
- Indexer idempotent by `(tx_id, event_index)`; reorg rollback rebuilds from
  the canonical event log; API rate-limited (300/min) with zod-validated IO;
  no server custody of user keys, ever.

## License

Apache-2.0
