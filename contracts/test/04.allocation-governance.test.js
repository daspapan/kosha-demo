const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { seededFixture, schedule, govern, vaultCall, openLoan, giveArc, r, DAY } = require("./helpers");

describe("04 Allocation, committee and timelock", () => {
  it("A-01 nobody but the timelock can allocate (members, partner, keeper, a single committee member)", async () => {
    const k = await loadFixture(seededFixture);
    for (const who of [k.acct.meera, k.acct.partner, k.acct.keeper, k.acct.committee[0], k.acct.attacker]) {
      await expect(k.vault.connect(who).allocateToGsec(r(1))).to.be.revertedWithCustomError(k.vault, "AccessControlUnauthorizedAccount");
    }
  });

  it("A-02 2-of-3 + 24 h moves 30% into G-secs", async () => {
    const k = await loadFixture(seededFixture);
    await govern(k, ...(await vaultCall(k, "allocateToGsec", [r(3000000)])));
    const a = await k.vault.allocation();
    expect([a.bufferBps, a.gsecBps, a.invoiceBps]).to.deep.equal([7000n, 3000n, 0n]);
  });

  it("A-03 G-sec cap: exactly 50% passes, one wei more fails", async () => {
    const k = await loadFixture(seededFixture);
    const op = await schedule(k, ...(await vaultCall(k, "allocateToGsec", [r(5000000) + 1n])));
    await time.increase(DAY);
    await expect(k.timelock.execute(op.target, 0, op.data, ethers.ZeroHash, op.salt)).to.be.revertedWithCustomError(k.vault, "GsecCapExceeded");
    await govern(k, ...(await vaultCall(k, "allocateToGsec", [r(5000000)])));
    expect((await k.vault.allocation()).gsecBps).to.equal(5000n);
  });

  it("A-04 buffer floor: an allocation leaving under 15% fails even with G-secs under 50%; exactly 15% passes", async () => {
    const k = await loadFixture(seededFixture);
    for (let i = 0; i < 7; i++) await openLoan(k, k.acct.members[i], r(500000)); // 35L lent
    for (let i = 10; i < 14; i++) await k.vault.connect(k.acct.members[i]).withdraw(r(500000), k.acct.members[i].address, k.acct.members[i].address);
    // TVL 80L, idle 45L, loans 35L. 15% floor = 12L.
    const op = await schedule(k, ...(await vaultCall(k, "allocateToGsec", [r(3300000) + 1n])));
    await time.increase(DAY);
    await expect(k.timelock.execute(op.target, 0, op.data, ethers.ZeroHash, op.salt)).to.be.revertedWithCustomError(k.vault, "BufferBelowMinimum");
    await govern(k, ...(await vaultCall(k, "allocateToGsec", [r(3300000)])));
    expect((await k.vault.allocation()).bufferBps).to.equal(1500n);
  });

  it("A-05 even all three committee members cannot break a cap", async () => {
    const k = await loadFixture(seededFixture);
    const op = await schedule(k, ...(await vaultCall(k, "allocateToGsec", [r(6000000)])));
    await expect(k.multisig.connect(k.acct.committee[2]).confirm(op.id)).to.be.revertedWithCustomError(k.multisig, "ProposalClosed");
    await time.increase(DAY);
    await expect(k.timelock.execute(op.target, 0, op.data, ethers.ZeroHash, op.salt)).to.be.revertedWithCustomError(k.vault, "GsecCapExceeded");
  });

  it("V-01 one signature schedules nothing", async () => {
    const k = await loadFixture(seededFixture);
    const [target, data] = await vaultCall(k, "allocateToGsec", [r(1000)]);
    const salt = ethers.id("s");
    await k.multisig.connect(k.acct.committee[0]).submit(target, 0, data, salt, ethers.id("p"));
    expect(await k.timelock.isOperation(await k.multisig.operationId(1))).to.equal(false);
  });

  it("V-02 execution before 24 h fails; at 24 h it succeeds", async () => {
    const k = await loadFixture(seededFixture);
    const op = await schedule(k, ...(await vaultCall(k, "allocateToGsec", [r(1000)])));
    await time.increase(DAY - 60);
    await expect(k.timelock.execute(op.target, 0, op.data, ethers.ZeroHash, op.salt)).to.be.revertedWithCustomError(k.timelock, "TimelockUnexpectedOperationState");
    await time.increase(60);
    await k.timelock.execute(op.target, 0, op.data, ethers.ZeroHash, op.salt);
  });

  it("V-03 any single member can veto during the timelock", async () => {
    const k = await loadFixture(seededFixture);
    const op = await schedule(k, ...(await vaultCall(k, "allocateToGsec", [r(1000)])));
    await k.multisig.connect(k.acct.committee[2]).cancel(op.id);
    await time.increase(DAY);
    await expect(k.timelock.execute(op.target, 0, op.data, ethers.ZeroHash, op.salt)).to.be.revertedWithCustomError(k.timelock, "TimelockUnexpectedOperationState");
    await expect(k.multisig.connect(k.acct.committee[0]).cancel(op.id)).to.be.revertedWithCustomError(k.multisig, "ProposalClosed");
  });

  it("V-04 outsiders cannot submit; owners cannot double-confirm; a revoked vote does not count", async () => {
    const k = await loadFixture(seededFixture);
    const [target, data] = await vaultCall(k, "allocateToGsec", [r(1000)]);
    await expect(k.multisig.connect(k.acct.attacker).submit(target, 0, data, ethers.id("s"), ethers.id("p"))).to.be.revertedWithCustomError(k.multisig, "NotOwner");
    await k.multisig.connect(k.acct.committee[0]).submit(target, 0, data, ethers.id("s"), ethers.id("p"));
    await expect(k.multisig.connect(k.acct.committee[0]).confirm(1)).to.be.revertedWithCustomError(k.multisig, "AlreadyConfirmed");
    await k.multisig.connect(k.acct.committee[0]).revoke(1);
    expect((await k.multisig.getProposal(1)).confirmations).to.equal(0);
    await k.multisig.connect(k.acct.committee[1]).confirm(1);
    expect(await k.timelock.isOperation(await k.multisig.operationId(1))).to.equal(false);
    await expect(k.multisig.connect(k.acct.committee[0]).confirm(99)).to.be.revertedWithCustomError(k.multisig, "UnknownProposal");
  });

  it("V-05 anyone can execute a ready operation, so a dead keeper cannot block it", async () => {
    const k = await loadFixture(seededFixture);
    const op = await schedule(k, ...(await vaultCall(k, "allocateToGsec", [r(1000)])));
    await time.increase(DAY);
    await k.timelock.connect(k.acct.attacker).execute(op.target, 0, op.data, ethers.ZeroHash, op.salt);
    expect(await k.gsec.totalValue()).to.equal(r(1000));
  });

  it("V-06 the delay itself can only change through the timelock", async () => {
    const k = await loadFixture(seededFixture);
    await expect(k.timelock.connect(k.acct.committee[0]).updateDelay(60)).to.be.revertedWithCustomError(k.timelock, "TimelockUnauthorizedCaller");
    await govern(k, await k.timelock.getAddress(), k.timelock.interface.encodeFunctionData("updateDelay", [2 * DAY]));
    expect(await k.timelock.getMinDelay()).to.equal(2 * DAY);
  });

  it("V-07 a lost committee key is replaced only through governance", async () => {
    const k = await loadFixture(seededFixture);
    const [lost, , , ] = k.acct.committee;
    await expect(k.multisig.connect(lost).replaceOwner(lost.address, k.acct.issuer.address)).to.be.revertedWithCustomError(k.multisig, "NotTimelock");
    await govern(k, await k.multisig.getAddress(), k.multisig.interface.encodeFunctionData("replaceOwner", [lost.address, k.acct.issuer.address]), [1, 2]);
    expect(await k.multisig.isOwner(lost.address)).to.equal(false);
    expect(await k.multisig.isOwner(k.acct.issuer.address)).to.equal(true);
  });

  it("V-08 the AI proposal hash is recorded on-chain with the proposal", async () => {
    const k = await loadFixture(seededFixture);
    const h = ethers.sha256(ethers.toUtf8Bytes('{"move":"buffer->gsec","bps":800}'));
    const [target, data] = await vaultCall(k, "allocateToGsec", [r(1000)]);
    await expect(k.multisig.connect(k.acct.committee[0]).submit(target, 0, data, ethers.id("s"), h))
      .to.emit(k.multisig, "Submitted").withArgs(1, k.acct.committee[0].address, target, data, h);
    expect((await k.multisig.getProposal(1)).proposalHash).to.equal(h);
  });

  it("A-06 pausing blocks allocations even after approval", async () => {
    const k = await loadFixture(seededFixture);
    const op = await schedule(k, ...(await vaultCall(k, "allocateToGsec", [r(1000)])));
    await k.vault.connect(k.acct.reconciler).pause();
    await time.increase(DAY);
    await expect(k.timelock.execute(op.target, 0, op.data, ethers.ZeroHash, op.salt)).to.be.revertedWithCustomError(k.vault, "EnforcedPause");
  });

  it("A-07 G-sec money comes back to the buffer only after T+1, and only by allocator or keeper", async () => {
    const k = await loadFixture(seededFixture);
    await govern(k, ...(await vaultCall(k, "allocateToGsec", [r(2000000)])));
    await expect(k.vault.connect(k.acct.attacker).requestFromGsec(r(1))).to.be.revertedWithCustomError(k.vault, "Unauthorized");
    await expect(k.vault.connect(k.acct.keeper).requestFromGsec(r(2000001))).to.be.revertedWithCustomError(k.gsec, "InsufficientValue");
    await k.vault.connect(k.acct.keeper).requestFromGsec(r(500000));
    await expect(k.vault.claimFromGsec()).to.be.revertedWithCustomError(k.gsec, "NotReady");
    await time.increase(DAY);
    await k.vault.connect(k.acct.attacker).claimFromGsec(); // permissionless finish
    expect(await k.gsec.totalValue()).to.equal(r(1500000));
    await expect(k.vault.claimFromGsec()).to.be.revertedWithCustomError(k.gsec, "NothingPending");
  });

  it("A-08 strategy entry points are vault-only", async () => {
    const k = await loadFixture(seededFixture);
    await expect(k.gsec.connect(k.acct.attacker).deposit(1)).to.be.revertedWithCustomError(k.gsec, "NotVault");
    await expect(k.gsec.connect(k.acct.attacker).requestWithdraw(1)).to.be.revertedWithCustomError(k.gsec, "NotVault");
    await expect(k.gsec.connect(k.acct.attacker).claim()).to.be.revertedWithCustomError(k.gsec, "NotVault");
  });

  it("A-09 coupons raise the share price for every member", async () => {
    const k = await loadFixture(seededFixture);
    await govern(k, ...(await vaultCall(k, "allocateToGsec", [r(4000000)])));
    const before = await k.vault.convertToAssets(r(1));
    await giveArc(k, k.acct.issuer, r(18082)); // ~30 days of 5.5% on 40L
    await k.arc.connect(k.acct.issuer).approve(await k.gsec.getAddress(), r(18082));
    await k.gsec.connect(k.acct.issuer).payCoupon(r(18082));
    expect(await k.vault.convertToAssets(r(1))).to.be.gt(before);
    await expect(k.gsec.connect(k.acct.attacker).setAprBps(100)).to.be.revertedWithCustomError(k.gsec, "AccessControlUnauthorizedAccount");
    await expect(k.gsec.connect(k.acct.issuer).setAprBps(2001)).to.be.revertedWithCustomError(k.gsec, "AprTooHigh");
    await expect(k.gsec.connect(k.acct.issuer).setAprBps(560)).to.emit(k.gsec, "AprSet").withArgs(560);
  });
});
