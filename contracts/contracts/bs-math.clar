;; ---------------------------------------------------------------------------
;; bs-math.clar -- fixed-point Black-Scholes engine (1e8 scale)
;;
;; All inputs/outputs are 8-decimal fixed-point integers ("fp"):
;;   real value v  <->  fp value v * 1e8
;; Signed `int` is used everywhere so intermediates can go negative.
;; 128-bit headroom: |int| < 1.7e38; at 1e8 scale a USD price ~1e13,
;; so products in fp-mul stay ~1e21-1e26, far below overflow.
;;
;; No loops or recursion exist in Clarity, so every series is either
;; unrolled (Horner form) or a `fold` over a constant list of bit levels.
;; Term counts are the fewest that hold an error bound ~1e-8..1e-6 on the
;; reduced ranges, keeping execution cost low (see tests/costs.test.ts).
;; ---------------------------------------------------------------------------

(define-constant ONE 100000000)                ;; 1.0
(define-constant ONE-U u100000000)
(define-constant TWO 200000000)                ;; 2.0
(define-constant LN2 69314718)                 ;; ln(2)
(define-constant TWO-POW-64 u18446744073709551616)

;; Abramowitz & Stegun 7.1.26 coefficients -- EXACTLY the prototype's
;; truncated constants so the TS mirror and Clarity agree term-for-term.
(define-constant AS-P 23164190)                ;; 0.2316419
(define-constant AS-B1 31938150)               ;; 0.3193815
(define-constant AS-B2 -35656380)              ;; -0.3565638
(define-constant AS-B3 178147800)              ;; 1.781478
(define-constant AS-B4 -182125600)             ;; -1.821256
(define-constant AS-B5 133027400)              ;; 1.330274
(define-constant INV-SQRT-2PI 39894230)        ;; 0.3989423

;; atanh series reciprocals (1/3, 1/5, 1/7, 1/9, 1/11, 1/13)
(define-constant C3 33333333)
(define-constant C5 20000000)
(define-constant C7 14285714)
(define-constant C9 11111111)
(define-constant C11 9090909)
(define-constant C13 7692308)

;; exp Taylor reciprocal factorials (1/2! .. 1/9!)
(define-constant F2 50000000)
(define-constant F3 16666667)
(define-constant F4 4166667)
(define-constant F5 833333)
(define-constant F6 138889)
(define-constant F7 19841)
(define-constant F8 2480)
(define-constant F9 276)

;; exp input clamp: e^66 * 1e8 ~ 4.6e36 stays inside int128
(define-constant EXP-MAX-X 6600000000)         ;; 66.0
;; |x| >= 6 saturates the normal CDF at 1e-8 resolution
(define-constant NCDF-CLAMP 600000000)         ;; 6.0

(define-constant ERR-DOMAIN (err u1001))       ;; input outside function domain

;; --- primitive fixed-point ops -------------------------------------------

;; a*b at fp scale; multiply before divide to keep precision
(define-read-only (fp-mul (a int) (b int))
  (/ (* a b) ONE))

;; a/b at fp scale; b must be non-zero (callers guard)
(define-read-only (fp-div (a int) (b int))
  (/ (* a ONE) b))

;; sqrt of an fp value: sqrt(x*1e8 * 1e8) = sqrt(x)*1e8, exact via sqrti
(define-read-only (fp-sqrt (x uint))
  (sqrti (* x ONE-U)))

;; --- natural log -----------------------------------------------------------

;; one conditional-halving step of the binary range reduction
(define-private (norm-step (bits uint) (st { m: uint, k: int }))
  (let ((p (pow u2 bits))
        (m (get m st)))
    (if (>= m (* ONE-U p))
        { m: (/ m p), k: (+ (get k st) (to-int bits)) }
        st)))

(define-constant NORM-LEVELS (list u64 u32 u16 u8 u4 u2 u1))

;; normalize x>0 to m in [ONE, 2*ONE) with x = m * 2^k
(define-private (ln-normalize (xu uint))
  (if (>= xu ONE-U)
      (fold norm-step NORM-LEVELS { m: xu, k: 0 })
      ;; x < 1: pre-scale by 2^64 so the same descending fold applies
      (fold norm-step NORM-LEVELS { m: (* xu TWO-POW-64), k: -64 })))

;; ln(m) for m in [ONE, 2*ONE) via 2*atanh(u), u=(m-1)/(m+1), |u|<1/3.
;; 7 odd terms: truncation < 1e-8 on the reduced range.
(define-private (ln-frac (m int))
  (let ((u (fp-div (- m ONE) (+ m ONE)))
        (v (fp-mul u u))
        (a5 (+ C11 (fp-mul v C13)))
        (a4 (+ C9 (fp-mul v a5)))
        (a3 (+ C7 (fp-mul v a4)))
        (a2 (+ C5 (fp-mul v a3)))
        (a1 (+ C3 (fp-mul v a2)))
        (a0 (+ ONE (fp-mul v a1))))
    (* 2 (fp-mul u a0))))

;; ln(x) for x > 0 (traps on x <= 0; bs-call-price guards first)
(define-read-only (fp-ln (x int))
  (begin
    (unwrap-panic (if (> x 0) (some true) none))
    (let ((norm (ln-normalize (to-uint x))))
      (+ (* (get k norm) LN2) (ln-frac (to-int (get m norm)))))))

;; --- exponential -----------------------------------------------------------

;; e^y for y in [0, ln2) -- 10-term Taylor (Horner), truncation < 1e-8
(define-private (exp-taylor (y int))
  (let ((a8 (+ F8 (fp-mul y F9)))
        (a7 (+ F7 (fp-mul y a8)))
        (a6 (+ F6 (fp-mul y a7)))
        (a5 (+ F5 (fp-mul y a6)))
        (a4 (+ F4 (fp-mul y a5)))
        (a3 (+ F3 (fp-mul y a4)))
        (a2 (+ F2 (fp-mul y a3)))
        (a1 (+ ONE (fp-mul y a2)))
        (a0 (+ ONE (fp-mul y a1))))
    a0))

;; e^x for x >= 0: x = n*ln2 + y, e^x = 2^n * e^y; clamped at EXP-MAX-X
(define-private (exp-pos (x int))
  (let ((xc (if (> x EXP-MAX-X) EXP-MAX-X x))
        (n (/ xc LN2))
        (y (- xc (* n LN2))))
    (* (exp-taylor y) (pow 2 n))))

;; e^x for any x; negative arguments via 1/e^(-x) (underflows to 0 below ~-18.4)
(define-read-only (fp-exp (x int))
  (if (>= x 0)
      (exp-pos x)
      (fp-div ONE (exp-pos (- 0 x)))))

;; --- standard normal CDF ---------------------------------------------------

;; Abramowitz-Stegun 7.1.26 with the prototype's truncated coefficients
(define-read-only (fp-normcdf (x int))
  (if (>= x NCDF-CLAMP) ONE
    (if (<= x (- 0 NCDF-CLAMP)) 0
      (let ((ax (if (< x 0) (- 0 x) x))
            (t (fp-div ONE (+ ONE (fp-mul AS-P ax))))
            (x2h (/ (fp-mul ax ax) 2))
            (phi (fp-mul INV-SQRT-2PI (fp-exp (- 0 x2h))))
            (p4 (+ AS-B4 (fp-mul t AS-B5)))
            (p3 (+ AS-B3 (fp-mul t p4)))
            (p2 (+ AS-B2 (fp-mul t p3)))
            (p1 (+ AS-B1 (fp-mul t p2)))
            (poly (fp-mul t p1))
            (cdf (- ONE (fp-mul phi poly))))
        (if (>= x 0) cdf (- ONE cdf))))))

;; --- Black-Scholes call ----------------------------------------------------

;; European call price, all args fp 1e8:
;;   d1 = (ln(S/K) + (r + sigma^2/2) T) / (sigma sqrt(T))
;;   d2 = d1 - sigma sqrt(T)
;;   C  = S N(d1) - K e^(-rT) N(d2)
(define-read-only (bs-call-price (s int) (k int) (sigma int) (t int) (r int))
  (begin
    (asserts! (> s 0) ERR-DOMAIN)
    (asserts! (> k 0) ERR-DOMAIN)
    (asserts! (> sigma 0) ERR-DOMAIN)
    (asserts! (> t 0) ERR-DOMAIN)
    (asserts! (>= r 0) ERR-DOMAIN)
    (let ((sqrt-t (to-int (fp-sqrt (to-uint t))))
          (vsqrt (fp-mul sigma sqrt-t)))
      (asserts! (> vsqrt 0) ERR-DOMAIN)
      (let ((d1 (fp-div (+ (fp-ln (fp-div s k))
                           (fp-mul (+ r (fp-div (fp-mul sigma sigma) TWO)) t))
                        vsqrt))
            (d2 (- d1 vsqrt))
            (disc (fp-exp (- 0 (fp-mul r t))))
            (price (- (fp-mul s (fp-normcdf d1))
                      (fp-mul k (fp-mul disc (fp-normcdf d2))))))
        (ok (if (< price 0) 0 price))))))
