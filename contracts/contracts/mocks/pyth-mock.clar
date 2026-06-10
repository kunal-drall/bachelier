;; mocks/pyth-mock.clar -- settable BTC-USD price feed for devnet/tests.
;; Price is 1e8 fixed-point USD; publish-time is a unix timestamp.
;; Open setters: this contract is only ever deployed on devnet, where the
;; keeper acts as a relayer. The oracle-adapter enforces staleness/positivity.

(define-data-var price int 10421000000000)   ;; $104,210.00 * 1e8
(define-data-var publish-time uint u0)

(define-public (set-price (p int) (t uint))
  (begin
    (var-set price p)
    (var-set publish-time t)
    (print { e: "price-set", price: p, publish-time: t })
    (ok true)))

;; convenience: stamp with the latest block time
(define-public (set-price-now (p int))
  (begin
    (var-set price p)
    (var-set publish-time (current-time))
    (print { e: "price-set", price: p, publish-time: (current-time) })
    (ok true)))

(define-read-only (get-price)
  { price: (var-get price), publish-time: (var-get publish-time) })

(define-read-only (current-time)
  (if (> stacks-block-height u0)
      (default-to u0 (get-stacks-block-info? time (- stacks-block-height u1)))
      u0))
