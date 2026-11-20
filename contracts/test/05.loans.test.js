const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { seededFixture, govern, vaultCall, openLoan, giveArc, invoiceHash, r, DAY } = require("./helpers");

describe("05 Member invoice pool", () => {
  it("L-01 the partner lends against a verified invoice; the member receives mARC", async () => {
    const k = await loadFixture(seededFixture);
    const m = k.acct.meera;
    await openLoan(k, m, r(200000));
    expect(await k.arc.balanceOf(m.address)).to.equal(r(200000));
    expect(await k.vault.loansOutstanding()).to.equal(r(200000));
    expect(await k.vault.memberExposure(m.address)).to.equal(r(200000));
    expect((await k.vault.allocation()).invoiceBps).to.equal(200n);
    expect(await k.vault.totalAssets()).to.equal(r(10000000)); // lending does not change TVL
  });

  it("L-02 nobody else can open a loan", async () => {
    const k = await loadFixture(seededFixture);
    const due = (await time.latest()) + 30 * DAY;
    for (const who of [k.acct.meera, k.acct.keeper, k.acct.committee[0], k.acct.attacker]) {
      await expect(k.vault.connect(who).openLoan(k.acct.meera.address, r(1), 1200, due, invoiceHash()))
        .to.be.revertedWithCustomError(k.vault, "AccessControlUnauthorizedAccount");
    }
  });

  it("L-03 per-member cap: exactly 5% passes, one wei more fails, across several invoices", async () => {
    const k = await loadFixture(seededFixture);
    const m = k.acct.meera;
    await openLoan(k, m, r(300000));
    await expect(openLoan(k, m, r(200000) + 1n)).to.be.revertedWithCustomError(k.vault, "MemberCapExceeded");
    await openLoan(k, m, r(200000));
    expect(await k.vault.memberExposure(m.address)).to.equal(r(500000));
  });

  it("L-04 pool cap: 35% across members passes, one wei more fails", async () => {
    const k = await loadFixture(seededFixture);
    for (let i = 0; i < 7; i++) await openLoan(k, k.acct.members[i], r(500000));
    await expect(openLoan(k, k.acct.members[7], 1n)).to.be.revertedWithCustomError(k.vault, "InvoiceCapExceeded");
  });

  it("L-05 an invoice can back only one loan; the zero hash is refused", async () => {
    const k = await loadFixture(seededFixture);
    const inv = invoiceHash("MCP-2026-118");
    await openLoan(k, k.acct.meera, r(1000), { inv });
    await expect(openLoan(k, k.acct.members[1], r(1000), { inv })).to.be.revertedWithCustomError(k.vault, "InvoiceAlreadyUsed");
    await expect(openLoan(k, k.acct.members[1], r(1000), { inv: ethers.ZeroHash })).to.be.revertedWithCustomError(k.vault, "InvalidInvoiceHash");
  });

  it("L-06 borrowers must be verified members of the pool", async () => {
    const k = await loadFixture(seededFixture);
    await expect(openLoan(k, k.acct.outsider, r(1))).to.be.revertedWithCustomError(k.vault, "NotVerified");
    await expect(openLoan(k, k.acct.issuer, r(1))).to.be.revertedWithCustomError(k.vault, "NotMember"); // verified, no shares
  });

  it("L-07 due date must be in (now, now + 180 days]; rate at most 30%", async () => {
    const k = await loadFixture(seededFixture);
    const now = await time.latest();
    const p = k.vault.connect(k.acct.partner);
    await expect(p.openLoan(k.acct.meera.address, r(1), 1200, now, invoiceHash())).to.be.revertedWithCustomError(k.vault, "BadDueDate");
    await expect(p.openLoan(k.acct.meera.address, r(1), 1200, now + 181 * DAY, invoiceHash())).to.be.revertedWithCustomError(k.vault, "BadDueDate");
    await expect(p.openLoan(k.acct.meera.address, r(1), 3001, now + 30 * DAY, invoiceHash())).to.be.revertedWithCustomError(k.vault, "RateTooHigh");
    await expect(p.openLoan(k.acct.meera.address, 0, 1200, now + 30 * DAY, invoiceHash())).to.be.revertedWithCustomError(k.vault, "ZeroAmount");
  });

  it("L-08 repayment with interest raises the share price and clears exposure; the exporter can pay directly", async () => {
    const k = await loadFixture(seededFixture);
    const m = k.acct.meera, exporter = k.acct.members[19];
    const id = await openLoan(k, m, r(200000), { rateBps: 1200 });
    const priceBefore = await k.vault.convertToAssets(r(1));
    await time.increase(30 * DAY);
    const interest = await k.vault.interestDue(id);
    expect(interest).to.be.closeTo(r(200000) * 1200n * 30n / 3650000n, r(1));
    await giveArc(k, exporter, r(210000));
    await k.arc.connect(exporter).approve(await k.vault.getAddress(), r(210000));
    await expect(k.vault.connect(exporter).repayLoan(id)).to.emit(k.vault, "LoanRepaid");
    expect(await k.vault.loansOutstanding()).to.equal(0);
    expect(await k.vault.memberExposure(m.address)).to.equal(0);
    expect(await k.vault.convertToAssets(r(1))).to.be.gt(priceBefore);
    await expect(k.vault.connect(exporter).repayLoan(id)).to.be.revertedWithCustomError(k.vault, "BadLoanStatus");
  });

  it("L-09 write-off only after due + 30 days; loss is shared; exposure stays until recovered", async () => {
    const k = await loadFixture(seededFixture);
    const m = k.acct.meera;
    const id = await openLoan(k, m, r(500000), { days: 60 });
    await time.increase(60 * DAY);
    await expect(k.vault.connect(k.acct.partner).writeOffLoan(id)).to.be.revertedWithCustomError(k.vault, "GraceNotOver");
    await expect(k.vault.connect(k.acct.attacker).writeOffLoan(id)).to.be.revertedWithCustomError(k.vault, "AccessControlUnauthorizedAccount");
    await time.increase(30 * DAY);
    const before = await k.vault.convertToAssets(r(1));
    await k.vault.connect(k.acct.partner).writeOffLoan(id);
    expect(await k.vault.convertToAssets(r(1))).to.be.lt(before);
    expect(await k.vault.totalAssets()).to.equal(r(9500000));
    await expect(openLoan(k, m, 1n)).to.be.revertedWithCustomError(k.vault, "MemberCapExceeded");
    // recovery: full repayment restores the pool
    await giveArc(k, m, r(100000)); // she already holds the 5L she borrowed
    await k.arc.connect(m).approve(await k.vault.getAddress(), r(600000));
    await k.vault.connect(m).repayLoan(id);
    expect(await k.vault.memberExposure(m.address)).to.equal(0);
    expect(await k.vault.totalAssets()).to.be.gt(r(10000000));
  });

  it("L-10 loans respect the buffer floor when redemptions have drained the buffer", async () => {
    const k = await loadFixture(seededFixture);
    await govern(k, ...(await vaultCall(k, "allocateToGsec", [r(5000000)])));
    for (let i = 10; i < 17; i++) await k.vault.connect(k.acct.members[i]).withdraw(r(500000), k.acct.members[i].address, k.acct.members[i].address);
    // TVL 65L, idle 15L (23%). Floor = 9.75L, so at most 5.25L may leave; member cap is 3.25L each.
    await openLoan(k, k.acct.members[0], r(325000));
    await openLoan(k, k.acct.members[1], r(200000));
    await expect(openLoan(k, k.acct.members[2], 1n)).to.be.revertedWithCustomError(k.vault, "BufferBelowMinimum");
  });

  it("L-11 pause stops new loans but never stops repayment", async () => {
    const k = await loadFixture(seededFixture);
    const id = await openLoan(k, k.acct.meera, r(1000));
    await k.vault.connect(k.acct.committee[1]).pause();
    await expect(openLoan(k, k.acct.members[1], r(1000))).to.be.revertedWithCustomError(k.vault, "EnforcedPause");
    await giveArc(k, k.acct.meera, r(100));
    await k.arc.connect(k.acct.meera).approve(await k.vault.getAddress(), r(1100));
    await k.vault.connect(k.acct.meera).repayLoan(id);
  });
});
