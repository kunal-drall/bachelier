;; ---------------------------------------------------------------------------
;; oracle-adapter.clar -- BTC-USD price source for the vault.
;;
;; The vault only ever calls this adapter, never a feed directly, so the feed
;; can be swapped per network without touching vault code:
;;   - devnet/simnet: statically wired to .pyth-mock (keeper acts as relayer)
;;   - testnet/mainnet: the deployment plan substitutes an adapter whose inner
;;     call reads the Trust Machines pyth-oracle-v3 contract (see README,
;;     "Oracle wiring") -- same interface, same guards.
;;
;; Guards enforced here regardless of source:
;;   ERR-BAD-PRICE   (u110): non-positive price
;;   ERR-STALE-PRICE (u109): publish-time older than max-age vs latest block
;; ---------------------------------------------------------------------------

(define-constant ERR-STALE-PRICE (err u109))
(define-constant ERR-BAD-PRICE (err u110))
(define-constant ERR-NOT-OWNER (err u108))

(define-data-var owner principal tx-sender)
(define-data-var max-age uint u3600)          ;; seconds a price may lag

(define-read-only (current-time)
  (if (> stacks-block-height u0)
      (default-to u0 (get-stacks-block-info? time (- stacks-block-height u1)))
      u0))

;; BTC-USD, 1e8 fixed-point, with staleness + sanity guards
(define-read-only (get-btc-price)
  (let ((quote (contract-call? .pyth-mock get-price))
        (p (get price quote))
        (pt (get publish-time quote)))
    (asserts! (> p 0) ERR-BAD-PRICE)
    (asserts! (>= (+ pt (var-get max-age)) (current-time)) ERR-STALE-PRICE)
    (ok { price: p, publish-time: pt })))

(define-read-only (get-max-age) (var-get max-age))

(define-public (set-max-age (secs uint))
  (begin
    (asserts! (is-eq tx-sender (var-get owner)) ERR-NOT-OWNER)
    (var-set max-age secs)
    (print { e: "max-age-set", max-age: secs })
    (ok true)))

(define-public (set-owner (new-owner principal))
  (begin
    (asserts! (is-eq tx-sender (var-get owner)) ERR-NOT-OWNER)
    (var-set owner new-owner)
    (print { e: "adapter-owner-set", owner: new-owner })
    (ok true)))
