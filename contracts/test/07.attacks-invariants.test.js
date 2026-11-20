const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time, setBalance } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { baseFixture, seededFixture, giveArc, depositViaGateway, invoiceHash, r, DAY } = require("./helpers");

describe("07 Attacks and invariants", () => {
  it("X-01 first-depositor inflation attack does not steal from the next depositor", async () => {
    const k = await loadFixture(baseFixture);
    const evil = k.acct.members[19], victim = k.acct.meera;
    await giveArc(k, evil, r(1000001));
    await k.arc.connect(evil).approve(await k.vault.getAddress(), 1n);
    await k.vault.connect(evil).deposit(1n, evil.address); // 1 wei
    await k.arc.connect(evil).transfer(await k.vault.getAddress(), r(1000000)); // donation
    await depositViaGateway(k, victim, r(500000));
    const victimValue = await k.vault.convertToAssets(await k.vault.balanceOf(victim.address));
    const evilValue = await k.vault.convertToAssets(await k.vault.balanceOf(evil.address));
    expect(victimValue).to.be.gte(r(500000) * 999n / 1000n); // loses < 0.1%
    expect(evilValue).to.be.lt(r(1000000)); // attacker loses money
  });

  it("X-02 an outside attacker is refused by every privileged function", async () => {
    const k = await loadFixture(seededFixture);
    const a = k.acct.attacker;
    const due = (await time.latest()) + 30 * DAY;
    const calls = [
      () => k.vault.connect(a).allocateToGsec(1),
      () => k.vault.connect(a).openLoan(a.address, 1, 1, due, invoiceHash()),
      () => k.vault.connect(a).writeOffLoan(1),
      () => k.vault.connect(a).pause(),
      () => k.vault.connect(a).unpause(),
      () => k.vault.connect(a).grantRole(ethers.ZeroHash, a.address),
      () => k.vault.connect(a).requestFromGsec(1),
      () => k.gateway.connect(a).settleDeposit(1),
      () => k.kyc.connect(a).setVerified(a.address, true),
      () => k.arc.connect(a).mint(a.address, 1),
      () => k.eInr.connect(a).mint(a.address, 1),
      () => k.multisig.connect(a).submit(a.address, 0, "0x", ethers.ZeroHash, ethers.ZeroHash),
      () => k.multisig.connect(a).cancel(1),
      () => k.timelock.connect(a).schedule(a.address, 0, "0x", ethers.ZeroHash, ethers.ZeroHash, DAY),
    ];
    for (const call of calls) await expect(call()).to.be.reverted;
  });

  it("X-03 a share transfer cannot be used to sneak shares to an outsider via approve + transferFrom", async () => {
    const k = await loadFixture(seededFixture);
    await k.vault.connect(k.acct.meera).approve(k.acct.attacker.address, r(100));
    await expect(k.vault.connect(k.acct.attacker).transferFrom(k.acct.meera.address, k.acct.attacker.address, r(100)))
      .to.be.revertedWithCustomError(k.vault, "NotVerified");
  });

  it("X-04 randomised run of 300 actions keeps every accounting invariant", async function () {
    this.timeout(180000);
    const k = await loadFixture(seededFixture);
    const T = await k.timelock.getAddress();
    await setBalance(T, ethers.parseEther("10"));
    const tl = await ethers.getImpersonatedSigner(T); // stands in for an approved, executed proposal
    const V = await k.vault.getAddress();
    let seed = 42;
    const rand = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    const loanIds = [];
    const reqIds = [];
    const check = async (label) => {
      const idle = await k.vault.idleAssets(), g = await k.gsec.totalValue(), L = await k.vault.loansOutstanding();
      expect(await k.vault.totalAssets(), label).to.equal(idle + g + L);
      expect(await k.arc.balanceOf(V), label).to.be.gte(await k.vault.reservedForClaims());
      expect(await k.eInr.balanceOf(await k.gateway.getAddress()), label).to.equal((await k.arc.totalSupply()) + (await k.gateway.pendingDeposits()));
      let active = 0n;
      for (const id of loanIds) { const l = await k.vault.loans(id); if (l.status === 1n) active += l.principal; }
      expect(L, label).to.equal(active);
    };
    const capsAfterActiveMove = async (label) => {
      const ta = await k.vault.totalAssets();
      expect((await k.vault.idleAssets()) * 10000n, label).to.be.gte(ta * 1500n);
    };
    for (let step = 0; step < 300; step++) {
      const m = k.acct.members[rand(20)];
      const action = rand(9);
      const amt = r(1 + rand(400000));
      try {
        if (action === 0) await depositViaGateway(k, m, amt);
        else if (action === 1) { const s = await k.vault.maxRedeem(m.address); if (s > 0n) await k.vault.connect(m).redeem(s / 3n + 1n, m.address, m.address); }
        else if (action === 2) { const b = await k.vault.balanceOf(m.address); if (b > 0n) { await k.vault.connect(m).requestRedeem(b / 4n + 1n); reqIds.push(await k.vault.nextRedeemId() - 1n); } }
        else if (action === 3 && reqIds.length) { const id = reqIds[rand(reqIds.length)]; await k.vault.fulfilRedeem(id); const o = (await k.vault.redeemRequests(id)).owner; await k.vault.connect(await ethers.getSigner(o)).claimRedeem(id); }
        else if (action === 4) { const id = await k.vault.nextLoanId(); await k.vault.connect(k.acct.partner).openLoan(m.address, amt / 4n, 1200, (await time.latest()) + 90 * DAY, invoiceHash()); loanIds.push(id); await capsAfterActiveMove(`loan@${step}`); }
        else if (action === 5 && loanIds.length) { const id = loanIds[rand(loanIds.length)]; const l = await k.vault.loans(id); const b = await ethers.getSigner(l.borrower); await giveArc(k, b, l.principal); await k.arc.connect(b).approve(V, l.principal * 2n); await k.vault.connect(b).repayLoan(id); }
        else if (action === 6) { await k.vault.connect(tl).allocateToGsec(amt * 3n); await capsAfterActiveMove(`alloc@${step}`); expect((await k.gsec.totalValue()) * 10000n).to.be.lte((await k.vault.totalAssets()) * 5000n); }
        else if (action === 7) { await k.vault.connect(k.acct.keeper).requestFromGsec(amt); await time.increase(DAY); await k.vault.claimFromGsec(); }
        else { await time.increase((1 + rand(10)) * DAY); }
      } catch (e) {
        // A refused action is fine; only custom-error refusals are expected.
        if (!/reverted|NotReady|NothingPending/.test(String(e.message))) throw e;
      }
      await check(`step ${step} action ${action}`);
    }
  });
});
