// tests/trend-token.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Cl, ClarityType, cvToValue, uintCV, someCV, noneCV, bufferCV } from "@stacks/transactions";

interface TokenState {
  totalMinted: bigint;
  totalBurned: bigint;
  burnRate: bigint;
  paused: boolean;
  adminLocked: boolean;
  owner: string;
  balances: Map<string, bigint>;
  allowances: Map<string, Map<string, bigint>>;
  blacklist: Set<string>;
}

class TrendTokenMock {
  private state: TokenState;
  private caller: string;
  private blockHeight: number;

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      totalMinted: BigInt(0),
      totalBurned: BigInt(0),
      burnRate: BigInt(10),
      paused: false,
      adminLocked: false,
      owner: "ST1OWNER",
      balances: new Map(),
      allowances: new Map(),
      blacklist: new Set(),
    };
    this.caller = "ST1OWNER";
    this.blockHeight = 100;
  }

  setCaller(caller: string) {
    this.caller = caller;
  }

  getCaller() {
    return this.caller;
  }

  private assertNotPaused(): { ok: true } | { ok: false; value: number } {
    return this.state.paused ? { ok: false, value: 107 } : { ok: true };
  }

  private assertAuthorized(): { ok: true } | { ok: false; value: number } {
    return this.caller === this.state.owner ? { ok: true } : { ok: false, value: 100 };
  }

  private assertNotLocked(): { ok: true } | { ok: false; value: number } {
    return this.state.adminLocked ? { ok: false, value: 105 } : { ok: true };
  }

  private assertValidAmount(amount: bigint): { ok: true } | { ok: false; value: number } {
    return amount > BigInt(0) ? { ok: true } : { ok: false, value: 106 };
  }

  private assertNotZeroAddress(addr: string): { ok: true } | { ok: false; value: number } {
    const zero = addr.startsWith("SP000") || addr.startsWith("ST000");
    return zero ? { ok: false, value: 108 } : { ok: true };
  }

  private assertNotBlacklisted(addr: string): { ok: true } | { ok: false; value: number } {
    return this.state.blacklist.has(addr) ? { ok: false, value: 102 } : { ok: true };
  }

  private calculateBurnAmount(amount: bigint): bigint {
    return (amount * this.state.burnRate) / BigInt(10000);
  }

  getName(): { ok: true; value: string } {
    return { ok: true, value: "Trend Token" };
  }

  getSymbol(): { ok: true; value: string } {
    return { ok: true, value: "TREND" };
  }

  getDecimals(): { ok: true; value: number } {
    return { ok: true, value: 6 };
  }

  getTotalSupply(): { ok: true; value: bigint } {
    const circulating = this.state.balances.values().reduce((sum, v) => sum + v, BigInt(0));
    return { ok: true, value: circulating };
  }

  getBalance(who: string): { ok: true; value: bigint } {
    return { ok: true, value: this.state.balances.get(who) || BigInt(0) };
  }

  getAllowance(owner: string, spender: string): { ok: true; value: bigint } {
    const ownerAllow = this.state.allowances.get(owner);
    return { ok: true, value: ownerAllow?.get(spender) || BigInt(0) };
  }

  getBurnRate(): { ok: true; value: bigint } {
    return { ok: true, value: this.state.burnRate };
  }

  isAdminLocked(): { ok: true; value: boolean } {
    return { ok: true, value: this.state.adminLocked };
  }

  isBlacklisted(who: string): { ok: true; value: boolean } {
    return { ok: true, value: this.state.blacklist.has(who) };
  }

  getContractOwner(): { ok: true; value: string } {
    return { ok: true, value: this.state.owner };
  }

  isContractPaused(): { ok: true; value: boolean } {
    return { ok: true, value: this.state.paused };
  }

  transfer(amount: bigint, sender: string, recipient: string, memo?: Uint8Array): { ok: true } | { ok: false; value: number } {
    const result = this.assertNotPaused();
    if (!result.ok) return result;

    const validAmt = this.assertValidAmount(amount);
    if (!validAmt.ok) return validAmt;

    const notZero = this.assertNotZeroAddress(recipient);
    if (!notZero.ok) return notZero;

    const notBlackSender = this.assertNotBlacklisted(sender);
    if (!notBlackSender.ok) return notBlackSender;

    const notBlackRec = this.assertNotBlacklisted(recipient);
    if (!notBlackRec.ok) return notBlackRec;

    if (this.caller !== sender) return { ok: false, value: 100 };

    const balance = this.state.balances.get(sender) || BigInt(0);
    if (balance < amount) return { ok: false, value: 101 };

    const burnAmount = this.calculateBurnAmount(amount);
    if (burnAmount > BigInt(0)) {
      const newSenderBal = (this.state.balances.get(sender) || BigInt(0)) - burnAmount;
      this.state.balances.set(sender, newSenderBal);
      this.state.totalBurned += burnAmount;
    }

    const transferAmount = amount - burnAmount;
    const senderBal = this.state.balances.get(sender) || BigInt(0);
    const recBal = this.state.balances.get(recipient) || BigInt(0);

    this.state.balances.set(sender, senderBal - amount);
    this.state.balances.set(recipient, recBal + transferAmount);

    if (memo) {
      console.log(`[transfer-memo] sender=${sender} recipient=${recipient} amount=${amount} memo=${Buffer.from(memo).toString("hex")}`);
    }

    return { ok: true };
  }

  approve(spender: string, amount: bigint): { ok: true } | { ok: false; value: number } {
    const paused = this.assertNotPaused();
    if (!paused.ok) return paused;

    const valid = this.assertValidAmount(amount);
    if (!valid.ok) return valid;

    const notZero = this.assertNotZeroAddress(spender);
    if (!notZero.ok) return notZero;

    if (!this.state.allowances.has(this.caller)) {
      this.state.allowances.set(this.caller, new Map());
    }
    this.state.allowances.get(this.caller)!.set(spender, amount);

    console.log(`[approval] owner=${this.caller} spender=${spender} amount=${amount}`);
    return { ok: true };
  }

  transferFrom(owner: string, spender: string, amount: bigint, recipient: string): { ok: true } | { ok: false; value: number } {
    const paused = this.assertNotPaused();
    if (!paused.ok) return paused;

    const valid = this.assertValidAmount(amount);
    if (!valid.ok) return valid;

    const notZero = this.assertNotZeroAddress(recipient);
    if (!notZero.ok) return notZero;

    const notBlackOwner = this.assertNotBlacklisted(owner);
    if (!notBlackOwner.ok) return notBlackOwner;

    const notBlackRec = this.assertNotBlacklisted(recipient);
    if (!notBlackRec.ok) return notBlackRec;

    if (this.caller !== spender) return { ok: false, value: 100 };

    const ownerAllow = this.state.allowances.get(owner)?.get(spender) || BigInt(0);
    if (ownerAllow < amount) return { ok: false, value: 101 };

    const burnAmount = this.calculateBurnAmount(amount);
    if (burnAmount > BigInt(0)) {
      const ownerBal = this.state.balances.get(owner) || BigInt(0);
      this.state.balances.set(owner, ownerBal - burnAmount);
      this.state.totalBurned += burnAmount;
    }

    const transferAmount = amount - burnAmount;
    const ownerBal = this.state.balances.get(owner) || BigInt(0);
    const recBal = this.state.balances.get(recipient) || BigInt(0);

    this.state.balances.set(owner, ownerBal - amount);
    this.state.balances.set(recipient, recBal + transferAmount);

    const newAllow = ownerAllow - amount;
    this.state.allowances.get(owner)!.set(spender, newAllow);

    return { ok: true };
  }

  burn(amount: bigint): { ok: true } | { ok: false; value: number } {
    const paused = this.assertNotPaused();
    if (!paused.ok) return paused;

    const valid = this.assertValidAmount(amount);
    if (!valid.ok) return valid;

    const balance = this.state.balances.get(this.caller) || BigInt(0);
    if (balance < amount) return { ok: false, value: 103 };

    this.state.balances.set(this.caller, balance - amount);
    this.state.totalBurned += amount;

    console.log(`[burn] burner=${this.caller} amount=${amount}`);
    return { ok: true };
  }

  mint(recipient: string, amount: bigint): { ok: true } | { ok: false; value: number } {
    const auth = this.assertAuthorized();
    if (!auth.ok) return auth;

    const locked = this.assertNotLocked();
    if (!locked.ok) return locked;

    const valid = this.assertValidAmount(amount);
    if (!valid.ok) return valid;

    const notZero = this.assertNotZeroAddress(recipient);
    if (!notZero.ok) return notZero;

    const bal = this.state.balances.get(recipient) || BigInt(0);
    this.state.balances.set(recipient, bal + amount);
    this.state.totalMinted += amount;

    console.log(`[mint] recipient=${recipient} amount=${amount}`);
    return { ok: true };
  }

  setBurnRate(newRate: bigint): { ok: true } | { ok: false; value: number } {
    const auth = this.assertAuthorized();
    if (!auth.ok) return auth;

    const locked = this.assertNotLocked();
    if (!locked.ok) return locked;

    if (newRate > BigInt(100)) return { ok: false, value: 106 };
    this.state.burnRate = newRate;
    return { ok: true };
  }

  pauseContract(): { ok: true } | { ok: false; value: number } {
    const auth = this.assertAuthorized();
    if (!auth.ok) return auth;
    this.state.paused = true;
    return { ok: true };
  }

  unpauseContract(): { ok: true } | { ok: false; value: number } {
    const auth = this.assertAuthorized();
    if (!auth.ok) return auth;
    this.state.paused = false;
    return { ok: true };
  }

  addToBlacklist(addr: string): { ok: true } | { ok: false; value: number } {
    const auth = this.assertAuthorized();
    if (!auth.ok) return auth;

    const notZero = this.assertNotZeroAddress(addr);
    if (!notZero.ok) return notZero;

    this.state.blacklist.add(addr);
    return { ok: true };
  }

  removeFromBlacklist(addr: string): { ok: true } {
    const auth = this.assertAuthorized();
    if (!auth.ok) return;
    this.state.blacklist.delete(addr);
    return { ok: true };
  }

  lockAdminPermanently(): { ok: true } | { ok: false; value: number } {
    const auth = this.assertAuthorized();
    if (!auth.ok) return auth;

    const locked = this.assertNotLocked();
    if (!locked.ok) return locked;

    this.state.adminLocked = true;
    return { ok: true };
  }

  transferOwnership(newOwner: string): { ok: true } | { ok: false; value: number } {
    const auth = this.assertAuthorized();
    if (!auth.ok) return auth;

    const locked = this.assertNotLocked();
    if (!locked.ok) return locked;

    const notZero = this.assertNotZeroAddress(newOwner);
    if (!notZero.ok) return notZero;

    this.state.owner = newOwner;
    return { ok: true };
  }
}

describe("Trend Token SIP-010 with Deflationary Mechanics", () => {
  let token: TrendTokenMock;
  let owner: string;
  let user1: string;
  let user2: string;
  let user3: string;

  beforeEach(() => {
    token = new TrendTokenMock();
    owner = "ST1OWNER";
    user1 = "ST1USER1";
    user2 = "ST1USER2";
    user3 = "ST1USER3";
    token.reset();
  });

  it("has correct metadata", () => {
    expect(token.getName().value).toBe("Trend Token");
    expect(token.getSymbol().value).toBe("TREND");
    expect(token.getDecimals().value).toBe(6);
  });

  it("mints initial supply to recipient", () => {
    token.setCaller(owner);
    token.mint(user1, BigInt(1000000));
    const bal = token.getBalance(user1).value;
    expect(bal).toBe(BigInt(1000000));
  });

  it("rejects mint by non-owner", () => {
    token.setCaller(user1);
    const result = token.mint(user1, BigInt(1000));
    expect(result.ok).toBe(false);
    expect(result.value).toBe(100);
  });

  it("applies burn rate correctly", () => {
    token.setCaller(owner);
    token.setBurnRate(BigInt(50));
    token.mint(user1, BigInt(10000));
    token.setCaller(user1);
    token.transfer(BigInt(1000), user1, user2, undefined);
    const burn = (BigInt(1000) * BigInt(50)) / BigInt(10000);
    expect(token.getBalance(user2).value).toBe(BigInt(1000) - burn);
  });

  it("allows approval and transferFrom", () => {
    token.setCaller(owner);
    token.mint(user1, BigInt(5000));
    token.setCaller(user1);
    token.approve(user2, BigInt(2000));
    token.setCaller(user2);
    const result = token.transferFrom(user1, user2, BigInt(1000), user3);
    expect(result.ok).toBe(true);
    const burn = (BigInt(1000) * BigInt(10)) / BigInt(10000);
    expect(token.getBalance(user3).value).toBe(BigInt(1000) - burn);
    expect(token.getAllowance(user1, user2).value).toBe(BigInt(1000));
  });

  it("rejects transfer with insufficient balance", () => {
    token.setCaller(user1);
    const result = token.transfer(BigInt(100), user1, user2, undefined);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(101);
  });

  it("prevents transfer to zero address", () => {
    token.setCaller(owner);
    token.mint(user1, BigInt(1000));
    token.setCaller(user1);
    const result = token.transfer(BigInt(100), user1, "SP0000000000000000000000000000000000", undefined);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(108);
  });

  it("blacklists address and blocks transfer", () => {
    token.setCaller(owner);
    token.addToBlacklist(user2);
    token.mint(user1, BigInt(1000));
    token.setCaller(user1);
    const result = token.transfer(BigInt(100), user1, user2, undefined);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(102);
  });

  it("pauses and unpauses contract", () => {
    token.setCaller(owner);
    token.pauseContract();
    expect(token.isContractPaused().value).toBe(true);
    token.mint(user1, BigInt(1000));
    const result = token.transfer(BigInt(100), user1, user2, undefined);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(107);
    token.unpauseContract();
    expect(token.isContractPaused().value).toBe(false);
  });

  it("locks admin functions permanently", () => {
    token.setCaller(owner);
    token.lockAdminPermanently();
    const result = token.setBurnRate(BigInt(20));
    expect(result.ok).toBe(false);
    expect(result.value).toBe(105);
  });

  it("transfers ownership", () => {
    token.setCaller(owner);
    token.transferOwnership(user1);
    expect(token.getContractOwner().value).toBe(user1);
    token.setCaller(user1);
    token.mint(user2, BigInt(500));
    expect(token.getBalance(user2).value).toBe(BigInt(500));
  });

  it("burns tokens manually", () => {
    token.setCaller(owner);
    token.mint(user1, BigInt(1000));
    token.setCaller(user1);
    token.burn(BigInt(300));
    expect(token.getBalance(user1).value).toBe(BigInt(700));
  });

  it("handles memo in transfer", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    token.setCaller(owner);
    token.mint(user1, BigInt(1000));
    token.setCaller(user1);
    const memo = bufferCV(Buffer.from("test-memo", "utf8"));
    token.transfer(BigInt(100), user1, user2, memo.value);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("transfer-memo"));
    spy.mockRestore();
  });

  it("updates burn rate", () => {
    token.setCaller(owner);
    token.setBurnRate(BigInt(25));
    expect(token.getBurnRate().value).toBe(BigInt(25));
  });

  it("rejects burn rate over 1%", () => {
    token.setCaller(owner);
    const result = token.setBurnRate(BigInt(101));
    expect(result.ok).toBe(false);
    expect(result.value).toBe(106);
  });
});