// staking-vault.test.ts

import { describe, it, expect, beforeEach } from "vitest";
import { uintCV } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 200;
const ERR_INVALID_STAKE_AMOUNT = 201;
const ERR_INVALID_LOCK_PERIOD = 202;
const ERR_INVALID_REWARD_RATE = 203;
const ERR_STAKE_NOT_FOUND = 205;
const ERR_INSUFFICIENT_BALANCE = 206;
const ERR_LOCK_PERIOD_NOT_EXPIRED = 207;
const ERR_INVALID_PENALTY_RATE = 208;
const ERR_INVALID_REWARD_CLAIM = 209;
const ERR_VAULT_PAUSED = 210;
const ERR_MAX_STAKES_EXCEEDED = 214;
const ERR_INVALID_REWARD_POOL = 215;
const ERR_INVALID_EMERGENCY_WITHDRAW = 216;
const ERR_INVALID_OWNER = 217;
const ERR_INVALID_SLASH_RATE = 219;

interface Stake {
  staker: string;
  amount: number;
  lockPeriod: number;
  startTime: number;
  rewardClaimed: number;
  slashed: boolean;
  emergencyWithdrawn: boolean;
}

interface StakeUpdate {
  updateAmount: number;
  updateLockPeriod: number;
  updateTimestamp: number;
  updater: string;
}

interface Success<T> { ok: true; value: T }
interface Failure { ok: false; value: number }
type Result<T> = Success<T> | Failure;

interface SIP010Trait {
  transfer: (amount: number, sender: string, recipient: string, memo?: string) => Result<boolean>;
  getBalance: (principal: string) => Result<number>;
}

class MockToken implements SIP010Trait {
  balances: Map<string, number> = new Map();

  constructor(initialBalances: { [key: string]: number }) {
    for (const [principal, balance] of Object.entries(initialBalances)) {
      this.balances.set(principal, balance);
    }
  }

  transfer(amount: number, sender: string, recipient: string, memo?: string): Result<boolean> {
    const senderBalance = this.balances.get(sender) ?? 0;
    if (senderBalance < amount) return { ok: false, value: ERR_INSUFFICIENT_BALANCE };
    this.balances.set(sender, senderBalance - amount);
    const recipientBalance = this.balances.get(recipient) ?? 0;
    this.balances.set(recipient, recipientBalance + amount);
    return { ok: true, value: true };
  }

  getBalance(principal: string): Result<number> {
    return { ok: true, value: this.balances.get(principal) ?? 0 };
  }
}

class StakingVaultMock {
  state: {
    contractOwner: string;
    nextStakeId: number;
    maxStakes: number;
    minStakeAmount: number;
    maxLockPeriod: number;
    rewardRate: number;
    penaltyRate: number;
    vaultPaused: boolean;
    totalStaked: number;
    rewardPool: number;
    slashRate: number;
    governanceContract: string | null;
    stakes: Map<number, Stake>;
    stakesByStaker: Map<string, number[]>;
    stakeUpdates: Map<number, StakeUpdate>;
  } = {
    contractOwner: "ST1OWNER",
    nextStakeId: 0,
    maxStakes: 10000,
    minStakeAmount: 100,
    maxLockPeriod: 365,
    rewardRate: 5,
    penaltyRate: 10,
    vaultPaused: false,
    totalStaked: 0,
    rewardPool: 0,
    slashRate: 20,
    governanceContract: null,
    stakes: new Map(),
    stakesByStaker: new Map(),
    stakeUpdates: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1STAKER";
  tokenContract: MockToken;

  constructor(token: MockToken) {
    this.tokenContract = token;
    this.reset();
  }

  reset() {
    this.state = {
      contractOwner: "ST1OWNER",
      nextStakeId: 0,
      maxStakes: 10000,
      minStakeAmount: 100,
      maxLockPeriod: 365,
      rewardRate: 5,
      penaltyRate: 10,
      vaultPaused: false,
      totalStaked: 0,
      rewardPool: 0,
      slashRate: 20,
      governanceContract: null,
      stakes: new Map(),
      stakesByStaker: new Map(),
      stakeUpdates: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1STAKER";
  }

  getStake(id: number): Result<Stake | null> {
    return { ok: true, value: this.state.stakes.get(id) || null };
  }

  getStakeUpdates(id: number): Result<StakeUpdate | null> {
    return { ok: true, value: this.state.stakeUpdates.get(id) || null };
  }

  getStakesByStaker(staker: string): Result<number[]> {
    return { ok: true, value: this.state.stakesByStaker.get(staker) || [] };
  }

  getTotalStaked(): Result<number> {
    return { ok: true, value: this.state.totalStaked };
  }

  getRewardPool(): Result<number> {
    return { ok: true, value: this.state.rewardPool };
  }

  setGovernanceContract(contractPrincipal: string): Result<boolean> {
    if (this.caller !== this.state.contractOwner) return { ok: false, value: ERR_INVALID_OWNER };
    this.state.governanceContract = contractPrincipal;
    return { ok: true, value: true };
  }

  setMinStakeAmount(newMin: number): Result<boolean> {
    if (this.caller !== this.state.contractOwner) return { ok: false, value: ERR_INVALID_OWNER };
    if (newMin <= 0 || newMin < 100) return { ok: false, value: ERR_INVALID_STAKE_AMOUNT };
    this.state.minStakeAmount = newMin;
    return { ok: true, value: true };
  }

  setMaxLockPeriod(newMax: number): Result<boolean> {
    if (this.caller !== this.state.contractOwner) return { ok: false, value: ERR_INVALID_OWNER };
    if (newMax <= 0 || newMax > 365) return { ok: false, value: ERR_INVALID_LOCK_PERIOD };
    this.state.maxLockPeriod = newMax;
    return { ok: true, value: true };
  }

  setRewardRate(newRate: number): Result<boolean> {
    if (this.caller !== this.state.contractOwner) return { ok: false, value: ERR_INVALID_OWNER };
    if (newRate <= 0 || newRate > 20) return { ok: false, value: ERR_INVALID_REWARD_RATE };
    this.state.rewardRate = newRate;
    return { ok: true, value: true };
  }

  setPenaltyRate(newRate: number): Result<boolean> {
    if (this.caller !== this.state.contractOwner) return { ok: false, value: ERR_INVALID_OWNER };
    if (newRate > 50) return { ok: false, value: ERR_INVALID_PENALTY_RATE };
    this.state.penaltyRate = newRate;
    return { ok: true, value: true };
  }

  pauseVault(paused: boolean): Result<boolean> {
    if (this.caller !== this.state.contractOwner) return { ok: false, value: ERR_INVALID_OWNER };
    this.state.vaultPaused = paused;
    return { ok: true, value: true };
  }

  addToRewardPool(amount: number): Result<boolean> {
    if (this.state.vaultPaused) return { ok: false, value: ERR_VAULT_PAUSED };
    const transferResult = this.tokenContract.transfer(amount, this.caller, "contract");
    if (!transferResult.ok) return { ok: false, value: ERR_INSUFFICIENT_BALANCE };
    this.state.rewardPool += amount;
    return { ok: true, value: true };
  }

  stake(amount: number, lockPeriod: number): Result<number> {
    if (this.state.vaultPaused) return { ok: false, value: ERR_VAULT_PAUSED };
    if (amount < this.state.minStakeAmount || amount <= 0) return { ok: false, value: ERR_INVALID_STAKE_AMOUNT };
    if (lockPeriod <= 0 || lockPeriod > this.state.maxLockPeriod) return { ok: false, value: ERR_INVALID_LOCK_PERIOD };
    const currentStakes = this.state.stakesByStaker.get(this.caller) || [];
    if (currentStakes.length >= 100) return { ok: false, value: ERR_MAX_STAKES_EXCEEDED };
    const transferResult = this.tokenContract.transfer(amount, this.caller, "contract");
    if (!transferResult.ok) return { ok: false, value: ERR_INSUFFICIENT_BALANCE };
    const id = this.state.nextStakeId;
    this.state.stakes.set(id, {
      staker: this.caller,
      amount,
      lockPeriod,
      startTime: this.blockHeight,
      rewardClaimed: 0,
      slashed: false,
      emergencyWithdrawn: false,
    });
    this.state.stakesByStaker.set(this.caller, [...currentStakes, id]);
    this.state.totalStaked += amount;
    this.state.nextStakeId++;
    return { ok: true, value: id };
  }

  unstake(stakeId: number): Result<boolean> {
    const stake = this.state.stakes.get(stakeId);
    if (!stake) return { ok: false, value: ERR_STAKE_NOT_FOUND };
    if (stake.staker !== this.caller) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (this.state.vaultPaused) return { ok: false, value: ERR_VAULT_PAUSED };
    if (this.blockHeight < stake.startTime + stake.lockPeriod) return { ok: false, value: ERR_LOCK_PERIOD_NOT_EXPIRED };
    if (stake.slashed) return { ok: false, value: ERR_INVALID_STAKE_AMOUNT };
    if (stake.emergencyWithdrawn) return { ok: false, value: ERR_INVALID_EMERGENCY_WITHDRAW };
    const elapsed = this.blockHeight - stake.startTime;
    const reward = Math.floor((stake.amount * this.state.rewardRate * elapsed) / 36500);
    const totalReturn = stake.amount + reward;
    if (this.state.rewardPool < reward) return { ok: false, value: ERR_INVALID_REWARD_POOL };
    const transferResult = this.tokenContract.transfer(totalReturn, "contract", this.caller);
    if (!transferResult.ok) return { ok: false, value: ERR_INSUFFICIENT_BALANCE };
    this.state.rewardPool -= reward;
    this.state.totalStaked -= stake.amount;
    this.state.stakes.delete(stakeId);
    return { ok: true, value: true };
  }

  claimReward(stakeId: number): Result<number> {
    const stake = this.state.stakes.get(stakeId);
    if (!stake) return { ok: false, value: ERR_STAKE_NOT_FOUND };
    if (stake.staker !== this.caller) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (this.state.vaultPaused) return { ok: false, value: ERR_VAULT_PAUSED };
    const elapsed = this.blockHeight - stake.startTime;
    const reward = Math.floor((stake.amount * this.state.rewardRate * elapsed) / 36500);
    const unclaimed = reward - stake.rewardClaimed;
    if (unclaimed <= 0) return { ok: false, value: ERR_INVALID_REWARD_CLAIM };
    if (this.state.rewardPool < unclaimed) return { ok: false, value: ERR_INVALID_REWARD_POOL };
    const transferResult = this.tokenContract.transfer(unclaimed, "contract", this.caller);
    if (!transferResult.ok) return { ok: false, value: ERR_INSUFFICIENT_BALANCE };
    this.state.rewardPool -= unclaimed;
    this.state.stakes.set(stakeId, { ...stake, rewardClaimed: reward });
    return { ok: true, value: unclaimed };
  }

  emergencyWithdraw(stakeId: number): Result<number> {
    const stake = this.state.stakes.get(stakeId);
    if (!stake) return { ok: false, value: ERR_STAKE_NOT_FOUND };
    if (stake.staker !== this.caller) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (this.state.vaultPaused) return { ok: false, value: ERR_VAULT_PAUSED };
    if (stake.emergencyWithdrawn) return { ok: false, value: ERR_INVALID_EMERGENCY_WITHDRAW };
    const penalty = Math.floor((stake.amount * this.state.penaltyRate) / 100);
    const returnAmount = stake.amount - penalty;
    const transferResult = this.tokenContract.transfer(returnAmount, "contract", this.caller);
    if (!transferResult.ok) return { ok: false, value: ERR_INSUFFICIENT_BALANCE };
    this.state.totalStaked -= stake.amount;
    this.state.rewardPool += penalty;
    this.state.stakes.set(stakeId, { ...stake, emergencyWithdrawn: true });
    return { ok: true, value: returnAmount };
  }

  slashStake(stakeId: number): Result<boolean> {
    const stake = this.state.stakes.get(stakeId);
    if (!stake) return { ok: false, value: ERR_STAKE_NOT_FOUND };
    if (this.caller !== this.state.contractOwner) return { ok: false, value: ERR_INVALID_OWNER };
    if (stake.slashed) return { ok: false, value: ERR_INVALID_STAKE_AMOUNT };
    const slashAmount = Math.floor((stake.amount * this.state.slashRate) / 100);
    const remaining = stake.amount - slashAmount;
    this.state.totalStaked -= slashAmount;
    this.state.rewardPool += slashAmount;
    this.state.stakes.set(stakeId, { ...stake, slashed: true, amount: remaining });
    return { ok: true, value: true };
  }

  updateStake(stakeId: number, newAmount: number, newLockPeriod: number): Result<boolean> {
    const stake = this.state.stakes.get(stakeId);
    if (!stake) return { ok: false, value: ERR_STAKE_NOT_FOUND };
    if (stake.staker !== this.caller) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (newAmount < this.state.minStakeAmount || newAmount <= 0) return { ok: false, value: ERR_INVALID_STAKE_AMOUNT };
    if (newLockPeriod <= 0 || newLockPeriod > this.state.maxLockPeriod) return { ok: false, value: ERR_INVALID_LOCK_PERIOD };
    this.state.stakes.set(stakeId, {
      ...stake,
      amount: newAmount,
      lockPeriod: newLockPeriod,
      startTime: this.blockHeight,
    });
    this.state.stakeUpdates.set(stakeId, {
      updateAmount: newAmount,
      updateLockPeriod: newLockPeriod,
      updateTimestamp: this.blockHeight,
      updater: this.caller,
    });
    return { ok: true, value: true };
  }
}

describe("StakingVault", () => {
  let contract: StakingVaultMock;
  let token: MockToken;

  beforeEach(() => {
    token = new MockToken({ ST1STAKER: 10000, ST1OWNER: 10000, contract: 0 });
    contract = new StakingVaultMock(token);
    contract.reset();
  });

  it("stakes successfully", () => {
    const result = contract.stake(500, 30);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);
    const stake = contract.getStake(0).value;
    expect(stake?.amount).toBe(500);
    expect(stake?.lockPeriod).toBe(30);
    expect(stake?.staker).toBe("ST1STAKER");
    expect(contract.getTotalStaked().value).toBe(500);
    expect(token.getBalance("contract").value).toBe(500);
    expect(token.getBalance("ST1STAKER").value).toBe(9500);
  });

  it("rejects invalid stake amount", () => {
    const result = contract.stake(50, 30);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_STAKE_AMOUNT);
  });

  it("rejects invalid lock period", () => {
    const result = contract.stake(500, 400);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_LOCK_PERIOD);
  });

  it("unstakes successfully after lock period", () => {
    contract.stake(500, 30);
    contract.addToRewardPool(1000);
    contract.blockHeight = 31;
    const result = contract.unstake(0);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.getStake(0).value).toBe(null);
    expect(contract.getTotalStaked().value).toBe(0);
  });

  it("rejects unstake before lock period", () => {
    contract.stake(500, 30);
    contract.blockHeight = 20;
    const result = contract.unstake(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_LOCK_PERIOD_NOT_EXPIRED);
  });

  it("claims reward successfully", () => {
    contract.addToRewardPool(1000);
    contract.stake(500, 30);
    contract.blockHeight = 365;
    const result = contract.claimReward(0);
    expect(result.ok).toBe(true);
    expect(result.value).toBeGreaterThan(0);
  });

  it("performs emergency withdraw", () => {
    contract.stake(500, 30);
    const result = contract.emergencyWithdraw(0);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(450);
    const stake = contract.getStake(0).value;
    expect(stake?.emergencyWithdrawn).toBe(true);
    expect(contract.getTotalStaked().value).toBe(0);
    expect(contract.getRewardPool().value).toBe(50);
  });

  it("slashes stake successfully", () => {
    contract.caller = "ST1OWNER";
    contract.stake(500, 30);
    const result = contract.slashStake(0);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const stake = contract.getStake(0).value;
    expect(stake?.slashed).toBe(true);
    expect(stake?.amount).toBe(400);
    expect(contract.getTotalStaked().value).toBe(400);
    expect(contract.getRewardPool().value).toBe(100);
  });

  it("updates stake successfully", () => {
    contract.stake(500, 30);
    const result = contract.updateStake(0, 600, 60);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const stake = contract.getStake(0).value;
    expect(stake?.amount).toBe(600);
    expect(stake?.lockPeriod).toBe(60);
    const update = contract.getStakeUpdates(0).value;
    expect(update?.updateAmount).toBe(600);
    expect(update?.updateLockPeriod).toBe(60);
  });

  it("adds to reward pool", () => {
    const result = contract.addToRewardPool(1000);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.getRewardPool().value).toBe(1000);
    expect(token.getBalance("contract").value).toBe(1000);
  });

  it("sets reward rate", () => {
    contract.caller = "ST1OWNER";
    const result = contract.setRewardRate(10);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.rewardRate).toBe(10);
  });

  it("pauses vault", () => {
    contract.caller = "ST1OWNER";
    const result = contract.pauseVault(true);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.vaultPaused).toBe(true);
  });

  it("validates Clarity types", () => {
    const amountCV = uintCV(500);
    expect(amountCV.value).toEqual(BigInt(500));
  });
});