;; ---------------------------------------------------------------------------
;; bcshare-token.clar -- bcSHARE, the vault's SIP-010 receipt token (8 decimals).
;;
;; Single-ledger design: this token's balances ARE the vault's share ledger.
;; Every balance change (mint, burn, transfer) is therefore gated on the vault
;; contract, which harvests premium checkpoints before any change. Wallet-to-
;; wallet moves go through vault.transfer-shares so premium accounting stays
;; consistent; direct transfer calls from any other caller are rejected.
;; ---------------------------------------------------------------------------
(impl-trait .sip-010-trait.sip-010-trait)

(define-fungible-token bcshare)

(define-constant ERR-NOT-AUTHORIZED (err u401))

(define-data-var owner principal tx-sender)
(define-data-var vault principal tx-sender)   ;; set to .vault right after deploy

(define-public (set-vault (v principal))
  (begin
    (asserts! (is-eq tx-sender (var-get owner)) ERR-NOT-AUTHORIZED)
    (var-set vault v)
    (print { e: "vault-set", vault: v })
    (ok true)))

(define-public (mint (amount uint) (recipient principal))
  (begin
    (asserts! (is-eq contract-caller (var-get vault)) ERR-NOT-AUTHORIZED)
    (ft-mint? bcshare amount recipient)))

(define-public (burn (amount uint) (holder principal))
  (begin
    (asserts! (is-eq contract-caller (var-get vault)) ERR-NOT-AUTHORIZED)
    (ft-burn? bcshare amount holder)))

(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (is-eq contract-caller (var-get vault)) ERR-NOT-AUTHORIZED)
    (asserts! (is-eq tx-sender sender) ERR-NOT-AUTHORIZED)
    (try! (ft-transfer? bcshare amount sender recipient))
    (match memo to-print (print to-print) 0x)
    (ok true)))

(define-read-only (get-name) (ok "Bachelier Share"))
(define-read-only (get-symbol) (ok "bcSHARE"))
(define-read-only (get-decimals) (ok u8))
(define-read-only (get-balance (who principal)) (ok (ft-get-balance bcshare who)))
(define-read-only (get-total-supply) (ok (ft-get-supply bcshare)))
(define-read-only (get-token-uri) (ok none))
(define-read-only (get-vault) (var-get vault))
