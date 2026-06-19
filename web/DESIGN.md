# Bachelier — Frontend & UI design brief

Everything you need to design the product: the brand story, the landing-page
narrative (act by act, with copy), every app screen and component, all their
states, and an asset checklist. It is written to match what already exists in
`web/` so your designs map straight onto the code — where a design changes the
structure, that's a note for engineering, not a surprise.

---

## 1. Brand foundation

**Name.** *Bachelier*, after **Louis Bachelier (1870–1946)** — the French
mathematician who, in his 1900 Sorbonne thesis *Théorie de la spéculation*,
first modeled the random walk of market prices and derived a way to **price an
option**. He did it under Henri Poincaré, five years before Einstein used the
same Brownian-motion math in physics. The academy filed it under "curious" and
moved on; the work sat nearly forgotten for fifty years until Samuelson and
others rediscovered it, and it became the spine of Black–Scholes (1973, Nobel
1997). **The product is that 1900 formula, finally running where anyone can
check it: on-chain.**

**One-liner.** A covered-call vault on sBTC where every option is priced on-chain
by a fixed-point Black–Scholes engine. Deposit Bitcoin, earn weekly USDC premium.

**The thesis in one breath.** *The price of an option was computable in 1900.
For a century you had to trust whoever quoted it. Bachelier puts the formula
itself on the chain — so the price isn't quoted to you, it's proven to you.*

**Voice.** Editorial, precise, a little austere — a 1900 mathematical monograph,
not a crypto landing page. Short declarative sentences. Numbers are sacred and
always set in mono. Never hype, never emoji, never "🚀 to the moon." Confidence
comes from rigor, not adjectives. Allowed to be quietly beautiful about the math.

**Motifs (recurring visual language).**
- **The blueprint grid** — faint indigo graph-paper under everything (already the
  page background). The whole site reads like it's drawn on engineering paper.
- **The payoff curve** — the hockey-stick "covered call" line is the brand's
  signature shape. It appears live in the app and should recur on the landing as
  a drawn diagram and a section divider.
- **The formula** — `C = S·N(d₁) − K·e^(−rT)·N(d₂)` rendered as a typeset
  artifact, the way it would appear in the thesis. The hero's emphasis word
  *priced* is the human translation of that formula.
- **Marginalia / footnotes** — small mono annotations in the margins (dates,
  values, "fig. 1"), like a scholarly text. Great for captions and number labels.
- **Plates & figures** — diagrams numbered "Fig. 01 / Fig. 02" in small caps.

---

## 2. Design system (the tokens you'll design against)

**Palette** (warm paper + ink + indigo, amber/brick/green accents):
| token | hex | use |
|---|---|---|
| `--paper` | `#F4EFE4` | page background |
| `--paper-2` | `#FAF6EC` | cards, raised surfaces |
| `--paper-3` | `#EFE8D8` | wells, insets, table headers |
| `--ink` | `#1B1A16` | primary text |
| `--ink-soft` | `#5C564A` | secondary text |
| `--ink-faint` | `#8A8474` | labels, captions, ticks |
| `--indigo` | `#27314E` | primary buttons, emphasis, the payoff line |
| `--indigo-deep` | `#171E33` | button hover, deep accents |
| `--amber` | `#C2762A` | strike marker, accents, "active" chips |
| `--amber-soft` | `#E3A24A` | the "upside sold" shaded region |
| `--brick` | `#A8462F` | negative deltas, ITM "exercised" status, warnings |
| `--green` | `#3E6B4A` | positive deltas, "expired worthless" (good for the pool) |

**Type.**
- **Fraunces** (serif) — display/headlines. Use the *italic* in `--indigo` for
  the single emphasis word in a headline (e.g. *priced*, *proven*, *forgotten*).
- **Hanken Grotesk** (sans) — all body and UI text.
- **IBM Plex Mono** — **every number**: prices, APY, sats, addresses, countdowns,
  fig labels, dates. This is non-negotiable and is what makes it feel like a
  ledger/monograph.

**Form.** Radius `14px`. Card border `1px solid rgba(27,26,22,.12)`, shadow
`0 1px 0 rgba(27,26,22,.06)` (almost flat — print, not Material). Overline labels:
uppercase, letter-spacing ~`.14em`, ~`11px`, `--ink-faint`. Blueprint grid:
two 1px `rgba(39,49,78,.05)` line-gradients at `28px`.

**Buttons.** Primary = solid `--indigo`, paper text, hover `--indigo-deep`.
Secondary = transparent, `1px solid --ink`. No gradients, no glow.

**Deltas.** Up = `--green`, down = `--brick`, always with a sign and mono.

**Motion.** Restrained: fades and short slides only. **Respect
`prefers-reduced-motion`** — when set, no animation at all (including the payoff
canvas redraw easing). The number tickers may count up on first paint, else snap.

---

## 3. Sitemap & artboard inventory

Two routes. Design these artboards (desktop ≥1200, tablet ~834, mobile ~390):

**`/` Landing** — single long scroll, 8 narrative sections (Part 4).
**`/app` The vault dApp** — one screen, stacked blocks (Part 5):
top bar · page head · stat strip · two-panel grid (builder | yield+payoff) ·
rounds table · toast layer.

Plus component states (Part 6): disconnected / connected-empty /
connected-with-position / loading / error / paused; and the wallet + tx toasts.

---

## 4. The landing page — *the story*

A vertical scroll told as a short monograph in **eight acts**. Dynamic numbers
are marked ⟨live⟩; everything else is fixed copy you can typeset. The arc:
*a forgotten formula → what it computes → why it matters on Bitcoin → how the
vault works → why on-chain is the moat → the honest risks → step inside.*

### Act 1 — Hero · "The cold open"
The thesis statement. Calm, enormous, confident.

- Eyebrow (overline): `A COVERED-CALL VAULT ON sBTC · STACKS`
- Headline (Fraunces, *priced* in italic indigo):
  **"Yield, *priced* like it's 1900."**
- Subhead: "Deposit sBTC. The pool writes weekly out-of-the-money covered calls,
  priced by an on-chain Black–Scholes engine, and pays you the premium in USDC.
  A century-old formula, settled on Bitcoin."
- CTAs: **Launch app** (primary) · **How it works** (secondary, anchors to Act 4)
- Three stat chips ⟨live⟩: **Total value locked** (sBTC) · **Current APY** ·
  **BTC price** (USD). Mono values, small-caps labels, em-dash when loading.
- Visual: faint payoff curve drawn large behind/aside the headline on the
  blueprint grid, like a figure sketched in the margin. Consider a thin
  hand-drawn "fig. 1 — the covered call" annotation.

### Act 2 — The man · "1900"
The origin story. This is the emotional center; give it room and a portrait.

- Overline: `FIG. 01 — THE ORIGIN`
- Headline: **"A formula the world *forgot*."**
- Body (2 short paragraphs):
  > In 1900, a young mathematician named Louis Bachelier defended a thesis at the
  > Sorbonne under Henri Poincaré. In it he modeled the aimless wander of market
  > prices as Brownian motion — five years before Einstein used the same idea for
  > physics — and from it derived how to price an option.
  >
  > The committee found it strange; finance was no subject for mathematics. His
  > thesis earned an *honorable*, not the highest mark, and his work slept for half
  > a century before Samuelson and Black, Scholes and Merton woke it into the most
  > famous formula in finance.
- Pull-quote (Fraunces italic, large): *"The price was always computable. It
  just took a hundred years — and a blockchain — to make it provable."*
- Visual: an engraving-style **portrait of Bachelier** (or an abstract
  graphite-on-paper stand-in), a reproduction of the thesis title page
  *Théorie de la spéculation, 1900*, set like a museum plate with a mono caption:
  `Louis Bachelier · Théorie de la spéculation · Paris, 1900`.

### Act 3 — The idea · "What a price is made of"
Make the math beautiful, not intimidating. One figure, lightly annotated.

- Overline: `FIG. 02 — THE FORMULA`
- Headline: **"Five numbers in. One fair price out."**
- The formula as a typeset artifact, centered:
  `C = S · N(d₁) − K · e^(−rT) · N(d₂)`
- Five margin annotations (mono), each a one-liner:
  **S** spot price · **K** strike · **σ** volatility · **T** time to expiry ·
  **r** the risk-free rate.
- Body: "Give Black–Scholes the spot, the strike, how jumpy the market is, and
  how long until expiry — and it returns the one premium that leaves no free
  money on the table. Bachelier wrote the first version of this by hand. We wrote
  it in Clarity, so the chain computes it for every option the vault sells."
- Visual: the equation drawn on graph paper; the variables connect by thin
  leader lines to their plain-English labels (engineering-drawing style).

### Act 4 — The mechanism · "Three steps, one weekly cycle" `#how`
This already exists in code — keep the three cards verbatim.

- Overline: `THE MECHANISM` · Headline: **"Three steps, one weekly cycle."**
- Three numbered cards (`01 / 02 / 03`, big mono numerals):
  1. **Deposit sBTC** — "Supply sBTC to the vault and receive bcSHARE, your claim
     on the pool. Your Bitcoin keeps its spot exposure between the strike and the
     floor."
  2. **The pool writes weekly calls** — "Each week the vault sells out-of-the-money
     covered calls against its sBTC, with strike and premium set by an on-chain
     Black–Scholes engine."
  3. **Premium accrues in USDC** — "Buyers pay premium in USDC; it accrues to your
     share and is claimable any time. If the calls expire worthless, the pool keeps
     every cent."
- Visual: a small timeline/cycle diagram — Mon open → Fri 08:00 UTC expiry →
  settle → repeat — drawn as a ring or a week-long ruler.

### Act 5 — The payoff · "What you actually hold"
Teach the covered-call shape with the brand's signature curve.

- Overline: `FIG. 03 — THE PAYOFF`
- Headline: **"Trade the top for the *premium*."**
- Body: "A covered call keeps Bitcoin's gains up to the strike and hands you cash
  for the rest. Below the strike you hold your sBTC, cushioned by the premium;
  above it, the pool sells the upside it agreed to sell. Capped, collateralized,
  and never short more than it holds."
- Visual (static twin of the app's live canvas): x = BTC price at expiry;
  the **hold** line (ink, dashed, 45°) vs the **covered-call** line
  (indigo, solid, flattening past K); the wedge between them above K shaded in
  `--amber-soft`, labeled **"upside sold."** Vertical dotted markers at **spot**
  (ink) and **strike** (amber). Mono axis ticks.

### Act 6 — The moat · "Priced on-chain"
Why this isn't just another vault. Concrete, verifiable numbers.

- Overline: `FIG. 04 — THE ENGINE`
- Headline: **"Not quoted. *Computed.*"**
- Body: "Most yield products quote you a number and ask for trust. Bachelier runs
  the whole Black–Scholes calculation inside the contract — logarithm,
  exponential, the normal distribution — in fixed-point Clarity. Anyone can read
  the price the chain will charge before they sign."
- Reference figures (mono stat row, ⟨live where possible, else these defaults⟩):
  - **≈ $430** premium per 1-sBTC weekly call
  - **≈ 0.41% / week**
  - **≈ 23–24% APY** (weekly-compounded)
  - at spot ≈ $104,210, strike +10%, σ 0.55
  - caption: `verified on-chain · matches the reference to the cent`
- Visual: a snippet of the fixed-point engine (the `bs-call-price` lines) set as
  a code plate, or a "machine" diagram: inputs → engine → premium.

### Act 7 — On risk · "The honest part"
Trust is built here. Keep it plain; this copy already exists.

- Overline: `ON RISK`
- Body: "Covered calls cap upside above the strike: in a sharp rally the pool
  forgoes gains beyond the strike in exchange for premium collected up front.
  Premium cushions but does not eliminate downside — if BTC falls, the deposited
  sBTC falls with it, less the premium earned. Settlement is cash-and-collateral
  on-chain; smart-contract and oracle risk apply. This is experimental software
  on a test network. Nothing here is financial advice."
- Visual: set as a bordered "note" / errata block — smaller, sober, single column.

### Act 8 — The close · CTA + footer
- Headline (Fraunces): **"Step inside the vault."**
- Sub: "Connect a wallet, deposit testnet sBTC, and watch a 1900 formula price
  your yield in real time."
- CTA: **Launch app** (primary, large).
- Footer: "Bachelier — peer-to-pool covered-call options on sBTC. On-chain
  fixed-point Black–Scholes pricing." · right side, mono: **© 1900 · 2026**
  (the date range *is* the brand — keep it).

> Story spine, one line per act, if you want it on a sticky scroll rail:
> *1 The claim · 2 The man · 3 The formula · 4 The cycle · 5 The payoff ·
> 6 The engine · 7 The risk · 8 The door.*

---

## 5. The app (`/app`) — screens & components

One screen, top to bottom. Components map 1:1 to files in `web/src/components/`.

### 5.1 Top bar — `TopBar` (variant `app`)
- Left: wordmark **Bachelier.** (Fraunces) + a small **TESTNET** badge chip
  (amber outline).
- Right: **live BTC price pill** (`PricePill`) + **Connect** (`ConnectButton`)
  and, on testnet/devnet, a **Faucet** button (`FaucetButton`).
- `PricePill`: mono price, polls every 30s; a small ▲/▼ tints `--green`/`--brick`
  on change vs the previous tick. Em-dash while loading.
- `ConnectButton`: "Connect wallet" → after connect, a truncated mono address
  pill (`ST2C…9AG`) with a disconnect menu.
- Landing variant of the top bar is simpler: wordmark + TESTNET + **Launch app**.

### 5.2 Page head
- Overline `VAULT` · Headline **"The covered-call vault."** · one-line subhead:
  "Deposit sBTC and earn weekly USDC premium from on-chain Black–Scholes-priced
  covered calls — or buy this week's calls from the pool."

### 5.3 Stat strip — `StatStrip`
A horizontal row of vault facts, mono values, small-caps labels, dividers between.
Fields ⟨live⟩: **TVL** (sBTC) · **Share price** · **Premium pool** (USDC) ·
**Current APY** · **Capacity** (sBTC still writable). Skeleton shimmer while
loading; em-dash if a field is null. Design a 5-up desktop row that wraps to
2-up / 1-up on smaller screens.

### 5.4 Builder panel — `BuilderCard` (left column)
The interactive heart. A card with a **two-tab switch: [ Deposit | Buy calls ]**.

**Deposit tab:**
- Amount input (sBTC), mono, with a "max" affordance; helper showing the bcSHARE
  you'd receive ⟨derived⟩.
- Two projection controls that drive the yield panel:
  - **OTM %** segmented control: `+5% / +10% / +15%` (→ 500/1000/1500 bps).
  - **IV** slider: `0.30 … 0.90`, default **0.55**, mono readout.
- Primary button: **Connect wallet** → **Deposit sBTC** (label reflects state;
  disabled while busy or amount invalid).
- Below, when connected **and** the user holds shares: the **Position card**
  (5.6) renders inside.

**Buy calls tab** (the taker side; the contracts input + Buy button live in the
yield panel, 5.5): this tab reframes the controls so the OTM/IV reflect the live
round, and the right panel shows the premium to pay.

States: default, focus, invalid input (brick helper text), disabled,
busy ("Depositing…"). Show the same OTM/IV controls in both tabs.

### 5.5 Yield + payoff panel — `YieldCard` + `PayoffCanvas` (right column)
The output. A card with:
- A big **APY** figure (mono, hero-sized) + label ("forward, from quote" or
  "trailing realized").
- A small grid of derived numbers ⟨live from the quote⟩: **premium / sBTC**
  (≈ $430), **weekly %** (≈ 0.41%), **downside cushion %**, **breakeven**,
  **cap value** (K + premium), **strike**.
- The **live payoff canvas** (`PayoffCanvas`): the Act-5 figure, redrawing on
  every input change and on resize (DPR-aware). hold vs covered-call,
  "upside sold" shaded, spot & strike markers, mono ticks. Provide its empty
  state (no spot yet → faint axes + "awaiting price").
- In **Buy calls** mode: a **contracts** input (integer), the **total premium**
  quote (mono USDC), and the **Buy calls** button (with a 2% slippage note).
- A subtle **source badge**: "local estimate" vs "on-chain quote" so power users
  know whether the figure is the instant mirror or the contract's own price.

### 5.6 Position card — `PositionCard` (renders when the user has shares)
The depositor's holdings, real data from the indexer/chain:
- **Shares** (bcSHARE) · **Value** (sBTC) · **Claimable premium** (USDC, accruing).
- A **live countdown** to the current round's Friday 08:00 UTC expiry (mono,
  ticking each second).
- Actions: **Withdraw** (inline shares form; if a round is active and the amount
  exceeds idle collateral, it routes to *request-withdraw* and shows a
  "queued until settlement" hint) and **Claim premium**.
- States: nothing claimable (claim disabled), withdrawal queued (badge), busy.

### 5.7 Rounds table — `RoundsTable`
The history ledger, mono throughout:
- Columns: **Round #** · **Strike** · **Status** · **Premium collected** ·
  **Settlement price**.
- Status chips: **active** (amber), **expired worthless** (green — good for the
  pool), **exercised / ITM** (brick).
- States: loading skeleton rows, empty ("No rounds yet"), error (quiet inline
  message). Design row hover + a possible expand-to-detail.

### 5.8 Toasts — `Toasts`
Top-right stack, paper cards with ink border:
- **Submitted** (truncated txid + explorer link) → **Pending** (spinner, polls
  every 3s) → **Success** / **Failed**. On success the vault/positions/rounds
  data refreshes. Design the three states + the stack/spacing.

---

## 6. States, responsive, motion, accessibility

**Global states to design for every data surface:**
- **Disconnected** — full UI visible, actions say "Connect wallet"; position card
  hidden.
- **Connected · empty** — connected, no shares yet; builder + yield only.
- **Connected · with position** — position card present, premium accruing,
  countdown live.
- **Loading** — skeletons / em-dashes, never layout shift.
- **Error / chain-down** — quiet inline messages; the app still renders (it can
  read price/vault straight from the chain even with no backend).
- **Paused** (admin) — a banner: "Deposits paused"; withdraw/claim stay enabled.

**Responsive.** Two-panel grid (builder | yield) collapses to a single column
under ~900px; stat strip wraps 5→2→1; top-bar right cluster collapses (price pill
may hide on the smallest width; Connect stays). Tables scroll horizontally on
mobile rather than squashing.

**Motion.** Number count-ups on first paint; payoff curve eases on change; toasts
slide in. All gated behind `prefers-reduced-motion: reduce` → instant.

**Accessibility.** AA contrast (the palette passes on paper); visible focus rings
(indigo); the payoff canvas needs an aria-label / text summary; every number has
a label; hit targets ≥40px; don't rely on color alone for deltas (keep the sign).

---

## 7. Asset checklist (what to actually produce)

1. **Wordmark** "Bachelier." + favicon/app icon (a serif *B*, or the payoff
   hockey-stick mark).
2. **Bachelier portrait** — engraving/graphite style (or tasteful abstract
   stand-in) for Act 2, plus the *1900 thesis title page* plate.
3. **The formula plate** — `C = S·N(d₁) − K·e^(−rT) − N(d₂)` typeset on graph
   paper with leader-line annotations (Act 3).
4. **Payoff diagram** — the signature curve, both as a static landing figure
   (Acts 1 & 5) and matching the live canvas styling in the app.
5. **Weekly-cycle diagram** — Mon→Fri 08:00 UTC→settle ring/ruler (Act 4).
6. **Engine plate** — code/"machine" figure for Act 6.
7. **Section dividers** — thin blueprint rules / "Fig. 0X" plate headers.
8. **Component artboards** — all of §5 in their §6 states, desktop+tablet+mobile.
9. **OG/social image** — hero headline + payoff curve on paper.

> Engineering note: the landing currently implements Acts 1, 4, and 7 plus the
> hero stat chips. Acts 2, 3, 5, 6, 8 are new narrative sections to add once the
> visuals exist — they're additive and won't disturb the app.
