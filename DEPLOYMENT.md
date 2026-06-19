# Deployment handoff — run this from a local Claude Code

This file is a **self-contained brief for a local Claude Code instance** (or a
human) that has real network access. The cloud sandbox where this repo was
built can only reach npm + GitHub — it cannot reach the Stacks RPC/faucet or
Vercel — so the two deploy steps below must run somewhere with open egress
(your laptop). Everything is already coded, tested, and committed; these are
the only remaining actions.

> Suggested kickoff prompt for local Claude Code:
> *"Read DEPLOYMENT.md and execute Part A (deploy the Bachelier contracts to
> Stacks testnet) then Part B (deploy the web app to Vercel). Use the existing
> scripts. Report the deployer address, the contract explorer links, and the
> live Vercel URL."*

---

## What this project is (30-second orientation)

**Bachelier** is a peer-to-pool covered-call options vault on **sBTC / Stacks**,
written in Clarity, with options **priced on-chain** by a fixed-point
Black–Scholes engine (`contracts/contracts/bs-math.clar`). Depositors add sBTC
and get `bcSHARE`; each weekly round the keeper writes OTM calls; takers pay
USDC premium; settlement is collateral-backed in sBTC against the oracle.

Monorepo (pnpm + turbo, Node 20+):
`contracts/` (Clarinet/Clarity), `packages/shared/` (TS BS mirror, DTOs,
network config), `db/ indexer/ api/ keeper/` (TS services), `web/` (React+Vite).
All tests pass: `pnpm test` (140 across the workspace).

The web app has a **chain-direct mode**: with no REST API deployed it reads
price/vault/position straight from the Stacks node, so Vercel needs *only* the
static frontend — no backend required for a working testnet demo.

---

## Prerequisites

```bash
node -v            # >= 20 (22 recommended)
corepack enable && corepack prepare pnpm@10.33.0 --activate
cd <repo> && pnpm install
pnpm test          # optional sanity check; should be all green
```

You need outbound access to `api.testnet.hiro.so` (Stacks RPC + faucet) and,
for Part B, the Vercel CLI / dashboard.

---

## Part A — Deploy the contracts to Stacks testnet

The deploy script does everything: generates a wallet, funds it from the Hiro
faucet, publishes all 8 contracts in dependency order (Clarity 3), wires them
(`bcshare-token.set-vault`, relaxes oracle `max-age` to 8 days so the demo
round stays buyable without a live price relayer, sets a live BTC price, opens
round 1 at +10% OTM / IV 0.55), verifies the on-chain Black–Scholes reference
vector, and writes a deployment record. It is **idempotent** — safe to re-run;
it skips already-deployed contracts and already-applied wiring.

```bash
cd contracts
pnpm tsx scripts/deploy-testnet.ts
```

Expected: console logs for each deploy/wiring tx, a `bs-call-price(reference)`
line that **must equal `42848661381` ($428.49)**, and finally:

```
recorded -> deployments/testnet-deployment.json
DEPLOYER ADDRESS: ST...
explorer: https://explorer.hiro.so/address/ST...?chain=testnet
```

Artifacts:
- `contracts/settings/.testnet-deployer.json` — **the generated wallet
  (mnemonic + key). Gitignored. Back it up; it owns the contracts and is the
  keeper/owner.**
- `contracts/deployments/testnet-deployment.json` — public record (addresses,
  txids, round 1). Commit this.

### Bake the deployer into the repo (so every build uses it)

```bash
cd <repo>
ADDR=$(node -p "require('./contracts/deployments/testnet-deployment.json').deployer")
# replace the placeholder principal in the shared testnet config
sed -i '' "s/ST000000000000000000002AMW42H/$ADDR/g" packages/shared/src/networks.ts 2>/dev/null \
  || sed -i "s/ST000000000000000000002AMW42H/$ADDR/g" packages/shared/src/networks.ts
sed -i '' "s/<DEPLOYER>/$ADDR/g" indexer/chainhooks/vault-print.testnet.json 2>/dev/null \
  || sed -i "s/<DEPLOYER>/$ADDR/g" indexer/chainhooks/vault-print.testnet.json
git add contracts/deployments/testnet-deployment.json packages/shared/src/networks.ts indexer/chainhooks/vault-print.testnet.json
git commit -m "testnet: record deployed contracts + deployer address"
git push
```

(You can skip the `networks.ts` sed if you'd rather pass the address purely via
the Vercel env var in Part B — both paths work.)

### Faucet troubleshooting

If the script reports the faucet was rate-limited, fund the printed address
manually at <https://explorer.hiro.so/sandbox/faucet?chain=testnet> (deploying
all 8 contracts costs ~1.5 STX; the faucet gives ~500 STX), then re-run the
script — it resumes from where it left off.

---

## Part B — Deploy the web app to Vercel

The frontend is a static Vite build. Root directory is `web/`; it builds the
whole workspace's shared package transitively.

### Option 1 — Vercel CLI (fastest)

```bash
cd web
npx vercel login                      # opens browser
npx vercel link                       # create/link the project
# set env vars for production:
npx vercel env add VITE_STACKS_NETWORK production   # value: testnet
npx vercel env add VITE_BACHELIER_DEPLOYER production # value: the deployer ST... from Part A
# (leave VITE_API_URL UNSET -> chain-direct mode)
npx vercel --prod                     # build + deploy
```

`vercel.json` (already in `web/`) sets framework=vite, install
`pnpm install --no-frozen-lockfile`, build `pnpm build`, output `dist`, and SPA
rewrites. If Vercel asks for the **Root Directory**, set it to `web`.

### Option 2 — Vercel dashboard

1. New Project → import `kunal-drall/bachelier`.
2. **Root Directory: `web`**. Framework preset: **Vite** (auto-detected).
3. Build command `pnpm build`, output `dist`, install
   `pnpm install --no-frozen-lockfile`.
4. Environment Variables (Production):
   - `VITE_STACKS_NETWORK = testnet`
   - `VITE_BACHELIER_DEPLOYER = <deployer ST... from Part A>`
   - *(do not set `VITE_API_URL`)*
5. Deploy.

### Verify

Open the deployed URL:
- Landing + `/app` render in the editorial design (paper/indigo, Fraunces, mono
  numbers, payoff canvas).
- The BTC price pill and vault stats populate (read live from the testnet node).
- Connect Leather/Xverse (testnet), use the **Faucet** button to mint mock
  sBTC/USDC, then deposit → you receive bcSHARE; the position card and round
  countdown appear.

> If `VITE_BACHELIER_DEPLOYER` is wrong/unset the app builds but shows empty
> vault data (it's pointing at the placeholder principal). Re-set the env var
> and redeploy.

---

## Part C — (optional) Keep rounds live / run the backend

Not needed for a basic demo (round 1 is pre-opened and the oracle is fresh for
8 days). For ongoing operation:

- **Keeper** (opens/settles rounds, relays price on testnet since we use the
  mock feed). Put the deployer key in a secret store, then:
  ```bash
  cd keeper
  STACKS_NETWORK=testnet KEEPER_PRIVATE_KEY=<key from .testnet-deployer.json> \
    PRICE_RELAY=true pnpm start
  ```
- **Indexer + API + Postgres** (richer history, charts, trailing APY): see
  `docker-compose.yml` and `README.md`. The web app auto-upgrades from
  chain-direct to API data once `VITE_API_URL` points at a deployed API.

---

## State at handoff

- ✅ All contracts written, 78 contract tests + 140 workspace tests green,
  `clarinet check` clean.
- ✅ `contracts/scripts/deploy-testnet.ts` — wallet gen + faucet + deploy +
  wire + verify, idempotent.
- ✅ `web/vercel.json` + `VITE_BACHELIER_DEPLOYER` build override (verified: the
  address compiles into the bundle).
- ✅ Web chain-direct fallbacks so no backend is required.
- ⬜ Run Part A (needs Stacks RPC/faucet egress).
- ⬜ Run Part B (needs Vercel auth).
- A GitHub Actions workflow `.github/workflows/deploy-testnet.yml` does Part A
  in CI as an alternative — but the repo's account currently has Actions
  runners disabled, so local is the path.
