;; ---------------------------------------------------------------------------
;; vault.clar -- Bachelier: peer-to-pool covered-call vault on sBTC.
;;
;; Depositors add sBTC and receive bcSHARE pro-rata. Each weekly round the
;; keeper opens an OTM strike from the oracle spot; takers buy 1-sBTC call
;; contracts priced on-chain by bs-math, paying USDC premium that accrues to
;; depositors via a cumulative premium-per-share index. At expiry the round
;; settles against the oracle:
;;   S_exp <= K : options expire worthless, pool keeps sBTC + premium
;;   S_exp >  K : each contract owes (S_exp - K)/S_exp sBTC (always < 1), paid
;;                from collateral via pull-based `exercise`; remainder stays.
;; The pool can never write more contracts than whole sBTC it holds, so it is
;; always fully collateralized and settlement needs no external liquidity.
;;
;; Units:
;;   sBTC amounts/shares  : sats (1e8 = 1 sBTC)         [uint]
;;   USDC amounts         : micro-USDC (1e6 = 1 USDC)   [uint]
;;   prices / iv / rates  : 1e8 fixed-point             [int or uint]
;;   premium index        : micro-USDC * 1e12 per share-sat
;; ---------------------------------------------------------------------------

(use-trait sip010 .sip-010-trait.sip-010-trait)

;; --- errors ----------------------------------------------------------------
(define-constant ERR-PAUSED (err u100))                ;; protocol paused
(define-constant ERR-MIN-DEPOSIT (err u101))           ;; below minimum deposit
(define-constant ERR-ROUND-ACTIVE (err u102))          ;; previous round not settled
(define-constant ERR-ROUND-NOT-ACTIVE (err u103))      ;; no active round
(define-constant ERR-EXPIRED (err u104))               ;; round already expired
(define-constant ERR-NOT-EXPIRED (err u105))           ;; round not yet expired
(define-constant ERR-INSUFFICIENT-COVERAGE (err u106)) ;; not enough idle collateral
(define-constant ERR-NOT-KEEPER (err u107))            ;; caller is not the keeper
(define-constant ERR-NOT-OWNER (err u108))             ;; caller is not the owner
;; u109 ERR-STALE-PRICE and u110 ERR-BAD-PRICE propagate from oracle-adapter
(define-constant ERR-TRANSFER (err u111))              ;; token transfer failed
(define-constant ERR-WRONG-TOKEN (err u112))           ;; unexpected token principal
(define-constant ERR-ZERO-AMOUNT (err u113))           ;; zero amount/shares/contracts
(define-constant ERR-INSUFFICIENT-SHARES (err u114))   ;; more shares than balance
(define-constant ERR-LOCKED (err u115))                ;; collateral locked by round
(define-constant ERR-NO-POSITION (err u116))           ;; unknown round/position
(define-constant ERR-ALREADY-CLAIMED (err u117))       ;; payout already exercised
(define-constant ERR-NOT-SETTLED (err u118))           ;; round not settled yet
(define-constant ERR-BAD-PARAMS (err u119))            ;; config/params out of bounds
(define-constant ERR-NOTHING-TO-CLAIM (err u120))      ;; nothing claimable
(define-constant ERR-GRACE (err u121))                 ;; permissionless settle in grace
(define-constant ERR-STALE-SETTLEMENT (err u122))      ;; price predates expiry

;; --- constants ---------------------------------------------------------------
(define-constant ONE 100000000)               ;; 1.0 fp
(define-constant CONTRACT-SIZE u100000000)    ;; 1 contract covers 1 sBTC (sats)
(define-constant SECONDS-PER-YEAR 31536000)
(define-constant ACC-SCALE u1000000000000)    ;; premium index scale (1e12)
(define-constant STATUS-ACTIVE u1)
(define-constant STATUS-SETTLED u2)

;; --- roles / config ----------------------------------------------------------
(define-data-var owner principal tx-sender)
(define-data-var keeper principal tx-sender)
(define-data-var paused bool false)
(define-data-var sbtc-token principal .sbtc-token)
(define-data-var usdc-token principal .usdc-token)
(define-data-var min-deposit uint u100000)        ;; 0.001 sBTC
(define-data-var otm-min-bps uint u100)           ;; +1%
(define-data-var otm-max-bps uint u5000)          ;; +50%
(define-data-var iv-min uint u10000000)           ;; 0.10
(define-data-var iv-max uint u300000000)          ;; 3.00
(define-data-var round-len uint u604800)          ;; 7 days (seconds)
(define-data-var settle-grace uint u3600)         ;; 1 hour
(define-data-var risk-free-rate int 4000000)      ;; 0.04 fp

;; --- state -------------------------------------------------------------------
(define-data-var total-collateral uint u0)        ;; sats owned by depositors
(define-data-var reserved-payout uint u0)         ;; sats reserved for ITM buyers
(define-data-var premium-pool uint u0)            ;; uUSDC held for depositors
(define-data-var cumulative-premium uint u0)      ;; uUSDC collected all-time
(define-data-var acc-premium-per-share uint u0)   ;; uUSDC*ACC-SCALE per share-sat
(define-data-var total-queued-shares uint u0)
(define-data-var current-round uint u0)

(define-map rounds uint {
  status: uint,
  strike: int,
  iv: uint,
  spot-open: int,
  opened-at: uint,
  expiry: uint,
  contracts-written: uint,
  premium-collected: uint,
  settlement-price: int,
  payout-per-contract: uint,
  sbtc-paid-out: uint })

(define-map positions { round-id: uint, buyer: principal } {
  contracts: uint,
  premium-paid: uint,
  strike: int,
  claimed: bool,
  payout-sbtc: uint })

(define-map premium-debt principal uint)      ;; index checkpoint at last touch
(define-map pending-premium principal uint)   ;; harvested, unclaimed uUSDC
(define-map queued-shares principal uint)     ;; withdrawal intents

;; --- internal helpers ----------------------------------------------------------

(define-private (current-time)
  (if (> stacks-block-height u0)
      (default-to u0 (get-stacks-block-info? time (- stacks-block-height u1)))
      u0))

(define-private (shares-of (who principal))
  (unwrap-panic (contract-call? .bcshare-token get-balance who)))

(define-private (total-shares-internal)
  (unwrap-panic (contract-call? .bcshare-token get-total-supply)))

;; move any newly accrued premium into the user's pending bucket
(define-private (harvest (who principal))
  (let ((entitled (/ (* (shares-of who) (var-get acc-premium-per-share)) ACC-SCALE))
        (debt (default-to u0 (map-get? premium-debt who))))
    (if (> entitled debt)
        (map-set pending-premium who
                 (+ (default-to u0 (map-get? pending-premium who)) (- entitled debt)))
        true)))

;; re-anchor the user's index checkpoint to their current balance
(define-private (checkpoint (who principal))
  (map-set premium-debt who
           (/ (* (shares-of who) (var-get acc-premium-per-share)) ACC-SCALE)))

(define-private (round-inactive)
  (let ((rid (var-get current-round)))
    (if (is-eq rid u0)
        true
        (match (map-get? rounds rid)
          r (is-eq (get status r) STATUS-SETTLED)
          true))))

(define-private (written-now)
  (match (map-get? rounds (var-get current-round))
    r (if (is-eq (get status r) STATUS-ACTIVE) (get contracts-written r) u0)
    u0))

(define-private (dequeue (who principal) (amount uint))
  (let ((q (default-to u0 (map-get? queued-shares who)))
        (dec (if (> amount q) q amount)))
    (map-set queued-shares who (- q dec))
    (var-set total-queued-shares (- (var-get total-queued-shares) dec))))

;; --- depositor flows -------------------------------------------------------

;; deposit sBTC, receive bcSHARE pro-rata (1:1 on first deposit)
(define-public (deposit (amount uint) (sbtc <sip010>))
  (begin
    (asserts! (not (var-get paused)) ERR-PAUSED)
    (asserts! (is-eq (contract-of sbtc) (var-get sbtc-token)) ERR-WRONG-TOKEN)
    (asserts! (>= amount (var-get min-deposit)) ERR-MIN-DEPOSIT)
    (let ((user tx-sender)
          (supply (total-shares-internal))
          (coll (var-get total-collateral))
          (shares (if (is-eq supply u0) amount (/ (* amount supply) coll))))
      (asserts! (> shares u0) ERR-ZERO-AMOUNT)
      (harvest user)
      (unwrap! (contract-call? sbtc transfer amount user (as-contract tx-sender) none) ERR-TRANSFER)
      (try! (contract-call? .bcshare-token mint shares user))
      (var-set total-collateral (+ coll amount))
      (checkpoint user)
      (print { e: "deposit", user: user, amount: amount, shares: shares, round: (var-get current-round) })
      (ok shares))))

;; burn shares for sBTC; only the idle (not call-backed) portion can leave
(define-public (withdraw (shares uint) (sbtc <sip010>))
  (begin
    (asserts! (is-eq (contract-of sbtc) (var-get sbtc-token)) ERR-WRONG-TOKEN)
    (asserts! (> shares u0) ERR-ZERO-AMOUNT)
    (let ((user tx-sender)
          (bal (shares-of user))
          (supply (total-shares-internal))
          (coll (var-get total-collateral)))
      (asserts! (<= shares bal) ERR-INSUFFICIENT-SHARES)
      (let ((sbtc-out (/ (* shares coll) supply))
            (locked (* (written-now) CONTRACT-SIZE))
            (idle (if (> coll locked) (- coll locked) u0)))
        (asserts! (> sbtc-out u0) ERR-ZERO-AMOUNT)
        (asserts! (<= sbtc-out idle) ERR-LOCKED)
        (harvest user)
        (try! (contract-call? .bcshare-token burn shares user))
        (var-set total-collateral (- coll sbtc-out))
        (try! (as-contract (contract-call? sbtc transfer sbtc-out tx-sender user none)))
        (dequeue user shares)
        (checkpoint user)
        (print { e: "withdraw", user: user, shares: shares, sbtc-out: sbtc-out, round: (var-get current-round) })
        (ok sbtc-out)))))

;; queue shares for withdrawal at next settlement: queued collateral is
;; excluded from new call writing so it frees up when the round settles
(define-public (request-withdraw (shares uint))
  (let ((user tx-sender)
        (q (default-to u0 (map-get? queued-shares user))))
    (asserts! (> shares u0) ERR-ZERO-AMOUNT)
    (asserts! (<= (+ q shares) (shares-of user)) ERR-INSUFFICIENT-SHARES)
    (map-set queued-shares user (+ q shares))
    (var-set total-queued-shares (+ (var-get total-queued-shares) shares))
    (print { e: "withdraw-requested", user: user, shares: shares, round: (var-get current-round) })
    (ok true)))

(define-public (cancel-withdraw-request (shares uint))
  (begin
    (asserts! (> shares u0) ERR-ZERO-AMOUNT)
    (dequeue tx-sender shares)
    (print { e: "withdraw-request-cancelled", user: tx-sender, shares: shares })
    (ok true)))

;; pay out the caller's accrued USDC premium
(define-public (claim-premium (usdc <sip010>))
  (begin
    (asserts! (is-eq (contract-of usdc) (var-get usdc-token)) ERR-WRONG-TOKEN)
    (let ((user tx-sender))
      (harvest user)
      (checkpoint user)
      (let ((amt (default-to u0 (map-get? pending-premium user))))
        (asserts! (> amt u0) ERR-NOTHING-TO-CLAIM)
        (map-set pending-premium user u0)
        (var-set premium-pool (- (var-get premium-pool) amt))
        (try! (as-contract (contract-call? usdc transfer amt tx-sender user none)))
        (print { e: "claim", user: user, usdc: amt })
        (ok amt)))))

;; move bcSHARE between wallets with premium accounting kept in sync
(define-public (transfer-shares (amount uint) (recipient principal))
  (let ((sender tx-sender))
    (asserts! (> amount u0) ERR-ZERO-AMOUNT)
    (harvest sender)
    (harvest recipient)
    (try! (contract-call? .bcshare-token transfer amount sender recipient none))
    (checkpoint sender)
    (checkpoint recipient)
    ;; queued intents cannot exceed the remaining balance
    (let ((q (default-to u0 (map-get? queued-shares sender)))
          (bal (shares-of sender)))
      (if (> q bal) (dequeue sender (- q bal)) true))
    (print { e: "shares-transferred", from: sender, to: recipient, amount: amount })
    (ok true)))

;; --- round lifecycle ---------------------------------------------------------

;; keeper opens a weekly round at strike = spot * (1 + otm-bps/10000)
(define-public (start-round (otm-bps uint) (iv uint))
  (begin
    (asserts! (not (var-get paused)) ERR-PAUSED)
    (asserts! (is-eq tx-sender (var-get keeper)) ERR-NOT-KEEPER)
    (asserts! (and (>= otm-bps (var-get otm-min-bps)) (<= otm-bps (var-get otm-max-bps))) ERR-BAD-PARAMS)
    (asserts! (and (>= iv (var-get iv-min)) (<= iv (var-get iv-max))) ERR-BAD-PARAMS)
    (asserts! (round-inactive) ERR-ROUND-ACTIVE)
    (let ((quote (try! (contract-call? .oracle-adapter get-btc-price)))
          (spot (get price quote))
          (strike (/ (* spot (+ 10000 (to-int otm-bps))) 10000))
          (rid (+ (var-get current-round) u1))
          (t-now (current-time))
          (expiry (+ t-now (var-get round-len))))
      (map-set rounds rid {
        status: STATUS-ACTIVE,
        strike: strike,
        iv: iv,
        spot-open: spot,
        opened-at: t-now,
        expiry: expiry,
        contracts-written: u0,
        premium-collected: u0,
        settlement-price: 0,
        payout-per-contract: u0,
        sbtc-paid-out: u0 })
      (var-set current-round rid)
      (print { e: "round-started", round: rid, strike: strike, iv: iv, expiry: expiry, spot: spot, collateral: (var-get total-collateral) })
      (ok rid))))

;; permissionless: buy covered calls in the active round, premium in USDC,
;; priced live by the on-chain Black-Scholes engine
(define-public (buy-call (contracts uint) (usdc <sip010>))
  (begin
    (asserts! (not (var-get paused)) ERR-PAUSED)
    (asserts! (is-eq (contract-of usdc) (var-get usdc-token)) ERR-WRONG-TOKEN)
    (asserts! (> contracts u0) ERR-ZERO-AMOUNT)
    (let ((rid (var-get current-round))
          (round (unwrap! (map-get? rounds rid) ERR-ROUND-NOT-ACTIVE))
          (t-now (current-time))
          (buyer tx-sender))
      (asserts! (is-eq (get status round) STATUS-ACTIVE) ERR-ROUND-NOT-ACTIVE)
      (asserts! (< t-now (get expiry round)) ERR-EXPIRED)
      (asserts! (<= contracts (contracts-available)) ERR-INSUFFICIENT-COVERAGE)
      (let ((quote (try! (contract-call? .oracle-adapter get-btc-price)))
            (spot (get price quote))
            (t-fp (/ (* (to-int (- (get expiry round) t-now)) ONE) SECONDS-PER-YEAR))
            (prem-usd (try! (contract-call? .bs-math bs-call-price
                                            spot (get strike round) (to-int (get iv round))
                                            t-fp (var-get risk-free-rate))))
            (prem-usdc-per (/ (to-uint prem-usd) u100))    ;; USD 1e8 -> uUSDC 1e6
            (premium (* prem-usdc-per contracts))
            (supply (total-shares-internal))
            (pos-key { round-id: rid, buyer: buyer })
            (pos (default-to { contracts: u0, premium-paid: u0, strike: (get strike round), claimed: false, payout-sbtc: u0 }
                             (map-get? positions pos-key))))
        (asserts! (> premium u0) ERR-BAD-PARAMS)
        (unwrap! (contract-call? usdc transfer premium buyer (as-contract tx-sender) none) ERR-TRANSFER)
        (map-set rounds rid (merge round {
          contracts-written: (+ (get contracts-written round) contracts),
          premium-collected: (+ (get premium-collected round) premium) }))
        (map-set positions pos-key (merge pos {
          contracts: (+ (get contracts pos) contracts),
          premium-paid: (+ (get premium-paid pos) premium) }))
        (var-set premium-pool (+ (var-get premium-pool) premium))
        (var-set cumulative-premium (+ (var-get cumulative-premium) premium))
        (var-set acc-premium-per-share
                 (+ (var-get acc-premium-per-share) (/ (* premium ACC-SCALE) supply)))
        (print { e: "call-bought", round: rid, buyer: buyer, contracts: contracts, premium: premium, strike: (get strike round), spot: spot, t-fp: t-fp })
        (ok premium)))))

;; settle the round against the oracle. Keeper may settle from expiry;
;; anyone may settle once the grace window has passed (liveness backstop).
;; The price used must have been published at/after expiry.
(define-public (settle-round)
  (let ((rid (var-get current-round))
        (round (unwrap! (map-get? rounds rid) ERR-ROUND-NOT-ACTIVE))
        (t-now (current-time)))
    (asserts! (is-eq (get status round) STATUS-ACTIVE) ERR-ROUND-NOT-ACTIVE)
    (asserts! (>= t-now (get expiry round)) ERR-NOT-EXPIRED)
    (asserts! (or (is-eq tx-sender (var-get keeper))
                  (>= t-now (+ (get expiry round) (var-get settle-grace))))
              ERR-GRACE)
    (let ((quote (try! (contract-call? .oracle-adapter get-btc-price)))
          (s-exp (get price quote))
          (strike (get strike round))
          (written (get contracts-written round)))
      (asserts! (>= (get publish-time quote) (get expiry round)) ERR-STALE-SETTLEMENT)
      (let ((ppc (if (> s-exp strike)
                     (to-uint (/ (* (- s-exp strike) ONE) s-exp))
                     u0))
            (total-payout (* ppc written)))
        (map-set rounds rid (merge round {
          status: STATUS-SETTLED,
          settlement-price: s-exp,
          payout-per-contract: ppc,
          sbtc-paid-out: total-payout }))
        (var-set reserved-payout (+ (var-get reserved-payout) total-payout))
        (var-set total-collateral (- (var-get total-collateral) total-payout))
        (print { e: "round-settled", round: rid, settlement-price: s-exp, payout-per-contract: ppc, sbtc-paid-out: total-payout, premium-retained: (get premium-collected round) })
        (ok { settlement-price: s-exp, sbtc-paid-out: total-payout })))))

;; buyer pulls their ITM payout (sBTC) for a settled round
(define-public (exercise (round-id uint) (sbtc <sip010>))
  (begin
    (asserts! (is-eq (contract-of sbtc) (var-get sbtc-token)) ERR-WRONG-TOKEN)
    (let ((buyer tx-sender)
          (round (unwrap! (map-get? rounds round-id) ERR-NO-POSITION))
          (pos (unwrap! (map-get? positions { round-id: round-id, buyer: buyer }) ERR-NO-POSITION)))
      (asserts! (is-eq (get status round) STATUS-SETTLED) ERR-NOT-SETTLED)
      (asserts! (not (get claimed pos)) ERR-ALREADY-CLAIMED)
      (let ((payout (* (get payout-per-contract round) (get contracts pos))))
        (asserts! (> payout u0) ERR-NOTHING-TO-CLAIM)
        (map-set positions { round-id: round-id, buyer: buyer }
                 (merge pos { claimed: true, payout-sbtc: payout }))
        (var-set reserved-payout (- (var-get reserved-payout) payout))
        (try! (as-contract (contract-call? sbtc transfer payout tx-sender buyer none)))
        (print { e: "exercised", round: round-id, buyer: buyer, payout-sbtc: payout })
        (ok payout)))))

;; --- admin -------------------------------------------------------------------

(define-public (set-keeper (new-keeper principal))
  (begin
    (asserts! (is-eq tx-sender (var-get owner)) ERR-NOT-OWNER)
    (var-set keeper new-keeper)
    (print { e: "keeper-set", keeper: new-keeper })
    (ok true)))

(define-public (set-owner (new-owner principal))
  (begin
    (asserts! (is-eq tx-sender (var-get owner)) ERR-NOT-OWNER)
    (var-set owner new-owner)
    (print { e: "owner-set", owner: new-owner })
    (ok true)))

(define-public (pause)
  (begin
    (asserts! (is-eq tx-sender (var-get owner)) ERR-NOT-OWNER)
    (var-set paused true)
    (print { e: "paused" })
    (ok true)))

(define-public (unpause)
  (begin
    (asserts! (is-eq tx-sender (var-get owner)) ERR-NOT-OWNER)
    (var-set paused false)
    (print { e: "unpaused" })
    (ok true)))

(define-public (set-config (new-min-deposit uint) (new-otm-min uint) (new-otm-max uint)
                           (new-iv-min uint) (new-iv-max uint)
                           (new-round-len uint) (new-grace uint) (new-rate int))
  (begin
    (asserts! (is-eq tx-sender (var-get owner)) ERR-NOT-OWNER)
    (asserts! (and (> new-round-len u0)
                   (<= new-otm-min new-otm-max)
                   (<= new-iv-min new-iv-max)
                   (>= new-rate 0)
                   (<= new-rate 20000000)) ERR-BAD-PARAMS)
    (var-set min-deposit new-min-deposit)
    (var-set otm-min-bps new-otm-min)
    (var-set otm-max-bps new-otm-max)
    (var-set iv-min new-iv-min)
    (var-set iv-max new-iv-max)
    (var-set round-len new-round-len)
    (var-set settle-grace new-grace)
    (var-set risk-free-rate new-rate)
    (print { e: "config-set", min-deposit: new-min-deposit, otm-min: new-otm-min, otm-max: new-otm-max, iv-min: new-iv-min, iv-max: new-iv-max, round-len: new-round-len, grace: new-grace, rate: new-rate })
    (ok true)))

;; token principals may only change before any shares exist
(define-public (set-tokens (new-sbtc principal) (new-usdc principal))
  (begin
    (asserts! (is-eq tx-sender (var-get owner)) ERR-NOT-OWNER)
    (asserts! (is-eq (total-shares-internal) u0) ERR-BAD-PARAMS)
    (var-set sbtc-token new-sbtc)
    (var-set usdc-token new-usdc)
    (print { e: "tokens-set", sbtc: new-sbtc, usdc: new-usdc })
    (ok true)))

;; --- read-only views -----------------------------------------------------------

;; contracts still available to write in the active round; queued-withdrawal
;; collateral is excluded so it frees up at settlement
(define-read-only (contracts-available)
  (match (map-get? rounds (var-get current-round))
    round (if (and (is-eq (get status round) STATUS-ACTIVE)
                   (< (current-time) (get expiry round)))
              (let ((coll (var-get total-collateral))
                    (supply (total-shares-internal))
                    (queued-val (if (is-eq supply u0)
                                    u0
                                    (/ (* (var-get total-queued-shares) coll) supply)))
                    (free (if (> coll queued-val) (- coll queued-val) u0))
                    (cap (/ free CONTRACT-SIZE))
                    (written (get contracts-written round)))
                (if (> cap written) (- cap written) u0))
              u0)
    u0))

(define-read-only (get-vault-state)
  (let ((supply (total-shares-internal))
        (coll (var-get total-collateral)))
    {
      total-collateral-sbtc: coll,
      reserved-payout-sbtc: (var-get reserved-payout),
      total-shares: supply,
      share-price: (if (is-eq supply u0) (to-uint ONE) (/ (* coll (to-uint ONE)) supply)),
      premium-pool-usdc: (var-get premium-pool),
      cumulative-premium-usdc: (var-get cumulative-premium),
      acc-premium-per-share: (var-get acc-premium-per-share),
      total-queued-shares: (var-get total-queued-shares),
      current-round: (var-get current-round),
      contracts-available: (contracts-available),
      paused: (var-get paused),
      time: (current-time)
    }))

(define-read-only (get-round (round-id uint))
  (map-get? rounds round-id))

(define-read-only (get-position (round-id uint) (buyer principal))
  (map-get? positions { round-id: round-id, buyer: buyer }))

(define-read-only (get-user (who principal))
  (let ((bal (shares-of who))
        (supply (total-shares-internal))
        (entitled (/ (* bal (var-get acc-premium-per-share)) ACC-SCALE))
        (debt (default-to u0 (map-get? premium-debt who))))
    {
      shares: bal,
      value-sbtc: (if (is-eq supply u0) u0 (/ (* bal (var-get total-collateral)) supply)),
      claimable-premium-usdc: (+ (default-to u0 (map-get? pending-premium who))
                                 (if (> entitled debt) (- entitled debt) u0)),
      queued-shares: (default-to u0 (map-get? queued-shares who))
    }))

(define-read-only (preview-deposit (amount uint))
  (let ((supply (total-shares-internal))
        (coll (var-get total-collateral)))
    (if (is-eq supply u0) amount (/ (* amount supply) coll))))

(define-read-only (preview-withdraw (shares uint))
  (let ((supply (total-shares-internal)))
    (if (is-eq supply u0) u0 (/ (* shares (var-get total-collateral)) supply))))

;; quote a hypothetical fresh round at live spot (T = full round length)
(define-read-only (preview-quote (otm-bps uint) (iv uint) (contracts uint))
  (let ((quote (try! (contract-call? .oracle-adapter get-btc-price)))
        (spot (get price quote))
        (strike (/ (* spot (+ 10000 (to-int otm-bps))) 10000))
        (t-fp (/ (* (to-int (var-get round-len)) ONE) SECONDS-PER-YEAR))
        (prem-usd (try! (contract-call? .bs-math bs-call-price
                                        spot strike (to-int iv) t-fp (var-get risk-free-rate))))
        (prem-usdc-per (/ (to-uint prem-usd) u100)))
    (ok {
      spot: spot,
      strike: strike,
      t-fp: t-fp,
      premium-usd-fp: prem-usd,
      premium-per-contract-usdc: prem-usdc-per,
      premium-total-usdc: (* prem-usdc-per contracts)
    })))

;; quote buying `contracts` in the live round right now
(define-read-only (preview-quote-current (contracts uint))
  (let ((rid (var-get current-round))
        (round (unwrap! (map-get? rounds rid) ERR-ROUND-NOT-ACTIVE))
        (t-now (current-time)))
    (asserts! (is-eq (get status round) STATUS-ACTIVE) ERR-ROUND-NOT-ACTIVE)
    (asserts! (< t-now (get expiry round)) ERR-EXPIRED)
    (let ((quote (try! (contract-call? .oracle-adapter get-btc-price)))
          (spot (get price quote))
          (t-fp (/ (* (to-int (- (get expiry round) t-now)) ONE) SECONDS-PER-YEAR))
          (prem-usd (try! (contract-call? .bs-math bs-call-price
                                          spot (get strike round) (to-int (get iv round))
                                          t-fp (var-get risk-free-rate))))
          (prem-usdc-per (/ (to-uint prem-usd) u100)))
      (ok {
        spot: spot,
        strike: (get strike round),
        t-fp: t-fp,
        premium-usd-fp: prem-usd,
        premium-per-contract-usdc: prem-usdc-per,
        premium-total-usdc: (* prem-usdc-per contracts)
      }))))

(define-read-only (get-config)
  {
    owner: (var-get owner),
    keeper: (var-get keeper),
    paused: (var-get paused),
    sbtc-token: (var-get sbtc-token),
    usdc-token: (var-get usdc-token),
    min-deposit: (var-get min-deposit),
    otm-min-bps: (var-get otm-min-bps),
    otm-max-bps: (var-get otm-max-bps),
    iv-min: (var-get iv-min),
    iv-max: (var-get iv-max),
    round-len: (var-get round-len),
    settle-grace: (var-get settle-grace),
    risk-free-rate: (var-get risk-free-rate)
  })
