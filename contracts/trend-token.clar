;; contracts/trend-token.clar
(define-fungible-token trend u1000000000)

(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INSUFFICIENT-BALANCE u101)
(define-constant ERR-TRANSFER-FAILED u102)
(define-constant ERR-BURN-EXCEEDS-BALANCE u103)
(define-constant ERR-MINT-NOT-ALLOWED u104)
(define-constant ERR-ADMIN-LOCKED u105)
(define-constant ERR-INVALID-AMOUNT u106)
(define-constant ERR-PAUSED u107)
(define-constant ERR-TRANSFER-TO-ZERO u108)
(define-constant ERR-TRANSFER-FROM-ZERO u109)

(define-data-var contract-owner principal tx-sender)
(define-data-var is-paused bool false)
(define-data-var total-minted uint u0)
(define-data-var total-burned uint u0)
(define-data-var burn-rate-per-ten-thousand uint u10)
(define-data-var admin-locked bool false)

(define-map allowances
  { owner: principal, spender: principal }
  uint)

(define-map transfer-blacklist principal bool)

(define-read-only (get-name)
  (ok "Trend Token"))

(define-read-only (get-symbol)
  (ok "TREND"))

(define-read-only (get-decimals)
  (ok u6))

(define-read-only (get-total-supply)
  (ok (- (+ (var-get total-minted) (ft-get-supply trend)) (var-get total-burned))))

(define-read-only (get-balance (who principal))
  (ok (ft-get-balance trend who)))

(define-read-only (get-allowance (owner principal) (spender principal))
  (ok (default-to u0 (map-get? allowances { owner: owner, spender: spender }))))

(define-read-only (get-burn-rate)
  (ok (var-get burn-rate-per-ten-thousand)))

(define-read-only (is-admin-locked)
  (ok (var-get admin-locked)))

(define-read-only (is-blacklisted (who principal))
  (ok (default-to false (map-get? transfer-blacklist who))))

(define-read-only (get-contract-owner)
  (ok (var-get contract-owner)))

(define-read-only (is-contract-paused)
  (ok (var-get is-paused)))

(define-private (assert-not-paused)
  (asserts! (not (var-get is-paused)) (err ERR-PAUSED)))

(define-private (assert-authorized)
  (asserts! (is-eq tx-sender (var-get contract-owner)) (err ERR-NOT-AUTHORIZED)))

(define-private (assert-not-locked)
  (asserts! (not (var-get admin-locked)) (err ERR-ADMIN-LOCKED)))

(define-private (assert-valid-amount (amount uint))
  (asserts! (> amount u0) (err ERR-INVALID-AMOUNT)))

(define-private (is-zero-address (addr principal))
  (or
    (is-eq addr (as-contract tx-sender))
    (is-eq (unwrap-panic (principal-destruct? addr)) (unwrap-panic (principal-destruct? (as-contract tx-sender))))
  ))

(define-private (assert-not-zero-address (addr principal))
  (asserts! (not (is-zero-address addr)) (err ERR-TRANSFER-TO-ZERO)))

(define-private (assert-not-blacklisted (addr principal))
  (asserts! (not (default-to false (map-get? transfer-blacklist addr))) (err ERR-TRANSFER-FAILED)))

(define-private (calculate-burn-amount (amount uint))
  (let ((rate (var-get burn-rate-per-ten-thousand)))
    (/ (* amount rate) u10000)))

(define-private (execute-burn (amount uint) (sender principal))
  (let ((burn-amount (calculate-burn-amount amount)))
    (if (> burn-amount u0)
      (begin
        (try! (ft-burn? trend burn-amount sender))
        (var-set total-burned (+ (var-get total-burned) burn-amount))
        (ok burn-amount))
      (ok u0))))

(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (let ((burn-amount (calculate-burn-amount amount)))
    (try! (assert-not-paused))
    (try! (assert-valid-amount amount))
    (try! (assert-not-zero-address sender))
    (try! (assert-not-zero-address recipient))
    (try! (assert-not-blacklisted sender))
    (try! (assert-not-blacklisted recipient))
    (asserts! (is-eq tx-sender sender) (err ERR-NOT-AUTHORIZED))
    (asserts! (>= (ft-get-balance trend sender) amount) (err ERR-INSUFFICIENT-BALANCE))
    (if (> burn-amount u0)
      (begin
        (try! (ft-burn? trend burn-amount sender))
        (var-set total-burned (+ (var-get total-burned) burn-amount)))
      (ok true))
    (match memo
      data (print { event: "transfer-memo", sender: sender, recipient: recipient, amount: amount, memo: data })
      (ok true))
    (try! (ft-transfer? trend (- amount burn-amount) sender recipient))
    (ok true)))

(define-public (approve (spender principal) (amount uint))
  (begin
    (try! (assert-not-paused))
    (try! (assert-valid-amount amount))
    (try! (assert-not-zero-address spender))
    (map-set allowances
      { owner: tx-sender, spender: spender }
      amount)
    (print { event: "approval", owner: tx-sender, spender: spender, amount: amount })
    (ok true)))

(define-public (transfer-from (owner principal) (spender principal) (amount uint) (recipient principal))
  (let ((burn-amount (calculate-burn-amount amount))
        (available (default-to u0 (map-get? allowances { owner: owner, spender: spender }))))
    (try! (assert-not-paused))
    (try! (assert-valid-amount amount))
    (try! (assert-not-zero-address owner))
    (try! (assert-not-zero-address recipient))
    (try! (assert-not-blacklisted owner))
    (try! (assert-not-blacklisted recipient))
    (asserts! (is-eq tx-sender spender) (err ERR-NOT-AUTHORIZED))
    (asserts! (>= available amount) (err ERR-INSUFFICIENT-BALANCE))
    (if (> burn-amount u0)
      (begin
        (try! (ft-burn? trend burn-amount owner))
        (var-set total-burned (+ (var-get total-burned) burn-amount)))
      (ok true))
    (try! (ft-transfer? trend (- amount burn-amount) owner recipient))
    (map-set allowances
      { owner: owner, spender: spender }
      (- available amount))
    (ok true)))

(define-public (burn (amount uint))
  (begin
    (try! (assert-not-paused))
    (try! (assert-valid-amount amount))
    (asserts! (>= (ft-get-balance trend tx-sender) amount) (err ERR-BURN-EXCEEDS-BALANCE))
    (try! (ft-burn? trend amount tx-sender))
    (var-set total-burned (+ (var-get total-burned) amount))
    (print { event: "burn", burner: tx-sender, amount: amount })
    (ok true)))

(define-public (mint (recipient principal) (amount uint))
  (begin
    (try! (assert-authorized))
    (try! (assert-not-locked))
    (try! (assert-valid-amount amount))
    (try! (assert-not-zero-address recipient))
    (try! (ft-mint? trend amount recipient))
    (var-set total-minted (+ (var-get total-minted) amount))
    (print { event: "mint", recipient: recipient, amount: amount })
    (ok true)))

(define-public (set-burn-rate (new-rate uint))
  (begin
    (try! (assert-authorized))
    (try! (assert-not-locked))
    (asserts! (<= new-rate u100) (err ERR-INVALID-AMOUNT))
    (var-set burn-rate-per-ten-thousand new-rate)
    (ok true)))

(define-public (pause-contract)
  (begin
    (try! (assert-authorized))
    (var-set is-paused true)
    (ok true)))

(define-public (unpause-contract)
  (begin
    (try! (assert-authorized))
    (var-set is-paused false)
    (ok true)))

(define-public (add-to-blacklist (addr principal))
  (begin
    (try! (assert-authorized))
    (try! (assert-not-zero-address addr))
    (map-set transfer-blacklist addr true)
    (ok true)))

(define-public (remove-from-blacklist (addr principal))
  (begin
    (try! (assert-authorized))
    (map-delete transfer-blacklist addr)
    (ok true)))

(define-public (lock-admin-permanently)
  (begin
    (try! (assert-authorized))
    (try! (assert-not-locked))
    (var-set admin-locked true)
    (ok true)))

(define-public (transfer-ownership (new-owner principal))
  (begin
    (try! (assert-authorized))
    (try! (assert-not-locked))
    (try! (assert-not-zero-address new-owner))
    (var-set contract-owner new-owner)
    (ok true)))