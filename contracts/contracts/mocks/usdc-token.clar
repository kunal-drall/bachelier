;; mocks/usdc-token.clar -- devnet-only SIP-010 USDC stand-in (6 decimals).
;; `mint` is open so tests and the devnet faucet can fund any account.
(impl-trait .sip-010-trait.sip-010-trait)

(define-fungible-token usdc)

(define-constant ERR-NOT-AUTHORIZED (err u4))

(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (is-eq tx-sender sender) ERR-NOT-AUTHORIZED)
    (try! (ft-transfer? usdc amount sender recipient))
    (match memo to-print (print to-print) 0x)
    (ok true)))

(define-public (mint (amount uint) (recipient principal))
  (ft-mint? usdc amount recipient))

(define-read-only (get-name) (ok "USDC (mock)"))
(define-read-only (get-symbol) (ok "USDC"))
(define-read-only (get-decimals) (ok u6))
(define-read-only (get-balance (who principal)) (ok (ft-get-balance usdc who)))
(define-read-only (get-total-supply) (ok (ft-get-supply usdc)))
(define-read-only (get-token-uri) (ok none))
