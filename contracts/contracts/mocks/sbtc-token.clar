;; mocks/sbtc-token.clar -- devnet-only SIP-010 sBTC stand-in (8 decimals).
;; `mint` is open so tests and the devnet faucet can fund any account.
;; On testnet/mainnet the vault is pointed at the real sBTC contract instead.
(impl-trait .sip-010-trait.sip-010-trait)

(define-fungible-token sbtc)

(define-constant ERR-NOT-AUTHORIZED (err u4))

(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (is-eq tx-sender sender) ERR-NOT-AUTHORIZED)
    (try! (ft-transfer? sbtc amount sender recipient))
    (match memo to-print (print to-print) 0x)
    (ok true)))

(define-public (mint (amount uint) (recipient principal))
  (ft-mint? sbtc amount recipient))

(define-read-only (get-name) (ok "sBTC (mock)"))
(define-read-only (get-symbol) (ok "sBTC"))
(define-read-only (get-decimals) (ok u8))
(define-read-only (get-balance (who principal)) (ok (ft-get-balance sbtc who)))
(define-read-only (get-total-supply) (ok (ft-get-supply sbtc)))
(define-read-only (get-token-uri) (ok none))
