;; staking-vault.clar

(define-constant ERR-NOT-AUTHORIZED u200)
(define-constant ERR-INVALID-STAKE-AMOUNT u201)
(define-constant ERR-INVALID-LOCK-PERIOD u202)
(define-constant ERR-INVALID-REWARD-RATE u203)
(define-constant ERR-STAKE-ALREADY-EXISTS u204)
(define-constant ERR-STAKE-NOT-FOUND u205)
(define-constant ERR-INSUFFICIENT-BALANCE u206)
(define-constant ERR-LOCK-PERIOD-NOT-EXPIRED u207)
(define-constant ERR-INVALID-PENALTY-RATE u208)
(define-constant ERR-INVALID-REWARD-CLAIM u209)
(define-constant ERR-VAULT-PAUSED u210)
(define-constant ERR-INVALID-APY u211)
(define-constant ERR-INVALID-TOTAL-STAKED u212)
(define-constant ERR-INVALID-UPDATE-PARAM u213)
(define-constant ERR-MAX-STAKES-EXCEEDED u214)
(define-constant ERR-INVALID-REWARD-POOL u215)
(define-constant ERR-INVALID-EMERGENCY-WITHDRAW u216)
(define-constant ERR-INVALID-OWNER u217)
(define-constant ERR-INVALID-TIMESTAMP u218)
(define-constant ERR-INVALID-SLASH-RATE u219)
(define-constant ERR-INVALID-GOVERNANCE u220)

(define-data-var contract-owner principal tx-sender)
(define-data-var next-stake-id uint u0)
(define-data-var max-stakes uint u10000)
(define-data-var min-stake-amount uint u100)
(define-data-var max-lock-period uint u365)
(define-data-var reward-rate uint u5)
(define-data-var penalty-rate uint u10)
(define-data-var vault-paused bool false)
(define-data-var total-staked uint u0)
(define-data-var reward-pool uint u0)
(define-data-var slash-rate uint u20)
(define-data-var governance-contract (optional principal) none)

(define-map stakes
  uint
  {
    staker: principal,
    amount: uint,
    lock-period: uint,
    start-time: uint,
    reward-claimed: uint,
    slashed: bool,
    emergency-withdrawn: bool
  }
)

(define-map stakes-by-staker
  principal
  (list 100 uint)
)

(define-map stake-updates
  uint
  {
    update-amount: uint,
    update-lock-period: uint,
    update-timestamp: uint,
    updater: principal
  }
)

(define-trait sip010-trait
  (
    (transfer (uint principal principal (optional (buff 34))) (response bool uint))
    (get-balance (principal) (response uint uint))
  )
)

(define-read-only (get-stake (id uint))
  (map-get? stakes id)
)

(define-read-only (get-stake-updates (id uint))
  (map-get? stake-updates id)
)

(define-read-only (get-stakes-by-staker (staker principal))
  (default-to (list) (map-get? stakes-by-staker staker))
)

(define-read-only (get-total-staked)
  (ok (var-get total-staked))
)

(define-read-only (get-reward-pool)
  (ok (var-get reward-pool))
)

(define-private (validate-amount (amount uint))
  (if (and (>= amount (var-get min-stake-amount)) (> amount u0))
    (ok true)
    (err ERR-INVALID-STAKE-AMOUNT))
)

(define-private (validate-lock-period (period uint))
  (if (and (> period u0) (<= period (var-get max-lock-period)))
    (ok true)
    (err ERR-INVALID-LOCK-PERIOD))
)

(define-private (validate-reward-rate (rate uint))
  (if (and (> rate u0) (<= rate u20))
    (ok true)
    (err ERR-INVALID-REWARD-RATE))
)

(define-private (validate-penalty-rate (rate uint))
  (if (<= rate u50)
    (ok true)
    (err ERR-INVALID-PENALTY-RATE))
)

(define-private (validate-slash-rate (rate uint))
  (if (<= rate u100)
    (ok true)
    (err ERR-INVALID-SLASH-RATE))
)

(define-private (validate-timestamp (ts uint))
  (if (>= ts block-height)
    (ok true)
    (err ERR-INVALID-TIMESTAMP))
)

(define-private (validate-owner (p principal))
  (if (is-eq p (var-get contract-owner))
    (ok true)
    (err ERR-INVALID-OWNER))
)

(define-private (calculate-reward (stake-id uint))
  (match (map-get? stakes stake-id)
    stake
      (let
        (
          (elapsed (- block-height (get start-time stake)))
          (reward (/ (* (get amount stake) (var-get reward-rate) elapsed) u36500))
        )
        (ok reward)
      )
    (err ERR-STAKE-NOT-FOUND)
  )
)

(define-public (set-governance-contract (contract-principal principal))
  (begin
    (try! (validate-owner tx-sender))
    (var-set governance-contract (some contract-principal))
    (ok true)
  )
)

(define-public (set-min-stake-amount (new-min uint))
  (begin
    (try! (validate-owner tx-sender))
    (try! (validate-amount new-min))
    (var-set min-stake-amount new-min)
    (ok true)
  )
)

(define-public (set-max-lock-period (new-max uint))
  (begin
    (try! (validate-owner tx-sender))
    (try! (validate-lock-period new-max))
    (var-set max-lock-period new-max)
    (ok true)
  )
)

(define-public (set-reward-rate (new-rate uint))
  (begin
    (try! (validate-owner tx-sender))
    (try! (validate-reward-rate new-rate))
    (var-set reward-rate new-rate)
    (ok true)
  )
)

(define-public (set-penalty-rate (new-rate uint))
  (begin
    (try! (validate-owner tx-sender))
    (try! (validate-penalty-rate new-rate))
    (var-set penalty-rate new-rate)
    (ok true)
  )
)

(define-public (pause-vault (paused bool))
  (begin
    (try! (validate-owner tx-sender))
    (var-set vault-paused paused)
    (ok true)
  )
)

(define-public (add-to-reward-pool (amount uint) (token-contract <sip010-trait>))
  (begin
    (asserts! (not (var-get vault-paused)) (err ERR-VAULT-PAUSED))
    (try! (contract-call? token-contract transfer amount tx-sender (as-contract tx-sender) none))
    (var-set reward-pool (+ (var-get reward-pool) amount))
    (ok true)
  )
)

(define-public (stake (amount uint) (lock-period uint) (token-contract <sip010-trait>))
  (let
    (
      (next-id (var-get next-stake-id))
      (staker tx-sender)
      (current-stakes (get-stakes-by-staker staker))
    )
    (asserts! (not (var-get vault-paused)) (err ERR-VAULT-PAUSED))
    (try! (validate-amount amount))
    (try! (validate-lock-period lock-period))
    (asserts! (< (len current-stakes) u100) (err ERR-MAX-STAKES-EXCEEDED))
    (try! (contract-call? token-contract transfer amount staker (as-contract tx-sender) none))
    (map-set stakes next-id
      {
        staker: staker,
        amount: amount,
        lock-period: lock-period,
        start-time: block-height,
        reward-claimed: u0,
        slashed: false,
        emergency-withdrawn: false
      }
    )
    (map-set stakes-by-staker staker (append current-stakes next-id))
    (var-set total-staked (+ (var-get total-staked) amount))
    (var-set next-stake-id (+ next-id u1))
    (print { event: "stake-created", id: next-id, amount: amount, lock-period: lock-period })
    (ok next-id)
  )
)

(define-public (unstake (stake-id uint) (token-contract <sip010-trait>))
  (match (map-get? stakes stake-id)
    stake
      (begin
        (asserts! (is-eq (get staker stake) tx-sender) (err ERR-NOT-AUTHORIZED))
        (asserts! (not (var-get vault-paused)) (err ERR-VAULT-PAUSED))
        (asserts! (>= block-height (+ (get start-time stake) (get lock-period stake))) (err ERR-LOCK-PERIOD-NOT-EXPIRED))
        (asserts! (not (get slashed stake)) (err ERR-INVALID-STAKE-AMOUNT))
        (asserts! (not (get emergency-withdrawn stake)) (err ERR-INVALID-EMERGENCY-WITHDRAW))
        (let
          (
            (reward (unwrap! (calculate-reward stake-id) (err ERR-INVALID-REWARD-CLAIM)))
            (total-return (+ (get amount stake) reward))
          )
          (asserts! (>= (var-get reward-pool) reward) (err ERR-INVALID-REWARD-POOL))
          (try! (as-contract (contract-call? token-contract transfer total-return tx-sender tx-sender none)))
          (var-set reward-pool (- (var-get reward-pool) reward))
          (var-set total-staked (- (var-get total-staked) (get amount stake)))
          (map-delete stakes stake-id)
          (print { event: "unstake", id: stake-id, amount: (get amount stake), reward: reward })
          (ok true)
        )
      )
    (err ERR-STAKE-NOT-FOUND)
  )
)

(define-public (claim-reward (stake-id uint) (token-contract <sip010-trait>))
  (match (map-get? stakes stake-id)
    stake
      (begin
        (asserts! (is-eq (get staker stake) tx-sender) (err ERR-NOT-AUTHORIZED))
        (asserts! (not (var-get vault-paused)) (err ERR-VAULT-PAUSED))
        (let
          (
            (reward (unwrap! (calculate-reward stake-id) (err ERR-INVALID-REWARD-CLAIM)))
            (unclaimed (- reward (get reward-claimed stake)))
          )
          (asserts! (> unclaimed u0) (err ERR-INVALID-REWARD-CLAIM))
          (asserts! (>= (var-get reward-pool) unclaimed) (err ERR-INVALID-REWARD-POOL))
          (try! (as-contract (contract-call? token-contract transfer unclaimed tx-sender tx-sender none)))
          (var-set reward-pool (- (var-get reward-pool) unclaimed))
          (map-set stakes stake-id (merge stake { reward-claimed: reward }))
          (print { event: "reward-claimed", id: stake-id, amount: unclaimed })
          (ok unclaimed)
        )
      )
    (err ERR-STAKE-NOT-FOUND)
  )
)

(define-public (emergency-withdraw (stake-id uint) (token-contract <sip010-trait>))
  (match (map-get? stakes stake-id)
    stake
      (begin
        (asserts! (is-eq (get staker stake) tx-sender) (err ERR-NOT-AUTHORIZED))
        (asserts! (not (var-get vault-paused)) (err ERR-VAULT-PAUSED))
        (asserts! (not (get emergency-withdrawn stake)) (err ERR-INVALID-EMERGENCY-WITHDRAW))
        (let
          (
            (penalty (/ (* (get amount stake) (var-get penalty-rate)) u100))
            (return-amount (- (get amount stake) penalty))
          )
          (try! (as-contract (contract-call? token-contract transfer return-amount tx-sender tx-sender none)))
          (var-set total-staked (- (var-get total-staked) (get amount stake)))
          (var-set reward-pool (+ (var-get reward-pool) penalty))
          (map-set stakes stake-id (merge stake { emergency-withdrawn: true }))
          (print { event: "emergency-withdraw", id: stake-id, amount: return-amount, penalty: penalty })
          (ok return-amount)
        )
      )
    (err ERR-STAKE-NOT-FOUND)
  )
)

(define-public (slash-stake (stake-id uint) (token-contract <sip010-trait>))
  (match (map-get? stakes stake-id)
    stake
      (begin
        (try! (validate-owner tx-sender))
        (asserts! (not (get slashed stake)) (err ERR-INVALID-STAKE-AMOUNT))
        (let
          (
            (slash-amount (/ (* (get amount stake) (var-get slash-rate)) u100))
            (remaining (- (get amount stake) slash-amount))
          )
          (var-set total-staked (- (var-get total-staked) slash-amount))
          (var-set reward-pool (+ (var-get reward-pool) slash-amount))
          (map-set stakes stake-id (merge stake { slashed: true, amount: remaining }))
          (print { event: "stake-slashed", id: stake-id, slash-amount: slash-amount })
          (ok true)
        )
      )
    (err ERR-STAKE-NOT-FOUND)
  )
)

(define-public (update-stake (stake-id uint) (new-amount uint) (new-lock-period uint))
  (match (map-get? stakes stake-id)
    stake
      (begin
        (asserts! (is-eq (get staker stake) tx-sender) (err ERR-NOT-AUTHORIZED))
        (try! (validate-amount new-amount))
        (try! (validate-lock-period new-lock-period))
        (map-set stakes stake-id
          (merge stake
            {
              amount: new-amount,
              lock-period: new-lock-period,
              start-time: block-height
            }
          )
        )
        (map-set stake-updates stake-id
          {
            update-amount: new-amount,
            update-lock-period: new-lock-period,
            update-timestamp: block-height,
            updater: tx-sender
          }
        )
        (print { event: "stake-updated", id: stake-id })
        (ok true)
      )
    (err ERR-STAKE-NOT-FOUND)
  )
)