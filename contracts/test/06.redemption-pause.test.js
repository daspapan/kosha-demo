const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { seededFixture, govern, vaultCall, openLoan, giveArc, depositViaGateway, r, DAY } = require("./helpers");

/// 50% G-sec + 35% loans + 15% buffer, the tightest legal state.
async function tightFixture() {
  const k = await seededFixture();
  for (let i = 0; i < 7; i++) await openLoan(k, k.acct.members[i], r(500000));
  await govern(k, ...(await vaultCall(k, "allocateToGsec", [r(5000000)])));
  return k;
}

describe("06 Redemptions and pause", () => {
  it("R-01 an instant redemption pays exactly the previewed amount", async () => {
    const k = await loadFixture(seededFixture);
    const m = k.acct.meera;
    const shares = await k.vault.balanceOf(m.address);
    const preview = await k.vault.previewRedeem(shares);
    await k.vault.connect(m).redeem(shares, m.address, m.address);
    expect(await k.arc.balanceOf(m.address)).to.equal(preview);
  });

  it("R-02 instant redemptions are limited to the buffer; beyond it the request path is used", async () => {
    const k = await loadFixture(tightFixture);
    for (let i = 10; i < 13; i++) {
      const mem = k.acct.members[i];
      await k.vault.connect(mem).redeem(await k.vault.balanceOf(mem.address), mem.address, mem.address);
    }
    const late = k.acct.members[13];
    expect(await k.vault.maxRedeem(late.address)).to.be.lt(await k.vault.balanceOf(late.address));
    await expect(k.vault.connect(late).redeem(await k.vault.balanceOf(late.address), late.address, late.address))
      .to.be.revertedWithCustomError(k.vault, "ERC4626ExceededMaxRedeem");
  });

  it("R-03 a request locks shares; only its owner can cancel it", async () => {
    const k = await loadFixture(seededFixture);
    const m = k.acct.meera;
    const shares = await k.vault.balanceOf(m.address);
    await k.vault.connect(m).requestRedeem(shares);
    expect(await k.vault.balanceOf(m.address)).to.equal(0);
    expect(await k.vault.pendingRedeemShares()).to.equal(shares);
    await expect(k.vault.connect(k.acct.attacker).cancelRedeem(1)).to.be.revertedWithCustomError(k.vault, "NotRequestOwner");
    await k.vault.connect(m).cancelRedeem(1);
    expect(await k.vault.balanceOf(m.address)).to.equal(shares);
    await expect(k.vault.connect(m).cancelRedeem(1)).to.be.revertedWithCustomError(k.vault, "BadRedeemStatus");
  });

  it("R-04 full async path: no liquidity, keeper pulls G-secs T+1, anyone fulfils, only the owner claims, once", async () => {
    const k = await loadFixture(tightFixture);
    for (let i = 10; i < 13; i++) {
      const mem = k.acct.members[i];
      await k.vault.connect(mem).redeem(await k.vault.balanceOf(mem.address), mem.address, mem.address);
    }
    const m = k.acct.members[13];
    await k.vault.connect(m).requestRedeem(await k.vault.balanceOf(m.address));
    await expect(k.vault.fulfilRedeem(1)).to.be.revertedWithCustomError(k.vault, "InsufficientLiquidity");
    await k.vault.connect(k.acct.keeper).requestFromGsec(r(1000000));
    await time.increase(DAY);
    await k.vault.claimFromGsec();
    await k.vault.connect(k.acct.attacker).fulfilRedeem(1);
    const req = await k.vault.redeemRequests(1);
    await expect(k.vault.connect(k.acct.attacker).claimRedeem(1)).to.be.revertedWithCustomError(k.vault, "NotRequestOwner");
    await k.vault.connect(m).claimRedeem(1);
    expect(await k.arc.balanceOf(m.address)).to.equal(req.assets);
    expect(req.assets).to.be.closeTo(r(500000), r(1));
    await expect(k.vault.connect(m).claimRedeem(1)).to.be.revertedWithCustomError(k.vault, "BadRedeemStatus");
    await expect(k.vault.fulfilRedeem(1)).to.be.revertedWithCustomError(k.vault, "BadRedeemStatus");
  });

  it("R-05 the price is fixed at fulfilment, and reserved money is outside TVL and cannot be lent", async () => {
    const k = await loadFixture(seededFixture);
    const m = k.acct.meera;
    await k.vault.connect(m).requestRedeem(await k.vault.balanceOf(m.address));
    await k.vault.fulfilRedeem(1);
    const owed = (await k.vault.redeemRequests(1)).assets;
    expect(await k.vault.reservedForClaims()).to.equal(owed);
    expect(await k.vault.totalAssets()).to.equal(r(9500000));
    // a later gain does not change what she is owed
    await giveArc(k, k.acct.issuer, r(1000));
    await k.arc.connect(k.acct.issuer).transfer(await k.vault.getAddress(), r(1000));
    expect((await k.vault.redeemRequests(1)).assets).to.equal(owed);
    // idle excludes the reserved 5L, so it can be neither lent nor allocated
    expect(await k.vault.idleAssets()).to.equal(r(9501000));
    await k.vault.connect(m).claimRedeem(1);
    expect(await k.vault.reservedForClaims()).to.equal(0);
  });

  it("R-06 pause blocks new deposits and settlement; the partner refunds the stuck request", async () => {
    const k = await loadFixture(seededFixture);
    const m = k.acct.meera;
    await k.vault.connect(k.acct.reconciler).pause();
    expect(await k.vault.maxDeposit(m.address)).to.equal(0);
    await k.eInr.mint(m.address, r(100));
    await k.eInr.connect(m).approve(await k.gateway.getAddress(), r(100));
    await k.gateway.connect(m).requestDeposit(r(100), ethers.ZeroHash);
    const id = (await k.gateway.nextDepositId()) - 1n;
    await expect(k.gateway.connect(k.acct.partner).settleDeposit(id)).to.be.revertedWithCustomError(k.vault, "ERC4626ExceededMaxDeposit");
    await k.gateway.connect(k.acct.partner).rejectDeposit(id);
    expect(await k.eInr.balanceOf(m.address)).to.equal(r(100));
  });

  it("R-07 pause never traps money: instant redeem, request, fulfil and claim all work while paused", async () => {
    const k = await loadFixture(seededFixture);
    await k.vault.connect(k.acct.committee[0]).pause();
    const [a, b] = [k.acct.members[3], k.acct.members[4]];
    await k.vault.connect(a).redeem(await k.vault.balanceOf(a.address), a.address, a.address);
    await k.vault.connect(b).requestRedeem(await k.vault.balanceOf(b.address));
    await k.vault.fulfilRedeem(1);
    await k.vault.connect(b).claimRedeem(1);
    expect(await k.arc.balanceOf(b.address)).to.be.closeTo(r(500000), r(1));
  });

  it("R-08 pausers can pause but not unpause; only the timelock unpauses", async () => {
    const k = await loadFixture(seededFixture);
    await expect(k.vault.connect(k.acct.attacker).pause()).to.be.revertedWithCustomError(k.vault, "AccessControlUnauthorizedAccount");
    await k.vault.connect(k.acct.reconciler).pause();
    for (const who of [k.acct.reconciler, k.acct.committee[0], k.acct.partner]) {
      await expect(k.vault.connect(who).unpause()).to.be.revertedWithCustomError(k.vault, "AccessControlUnauthorizedAccount");
    }
    await govern(k, ...(await vaultCall(k, "unpause")));
    expect(await k.vault.paused()).to.equal(false);
    await depositViaGateway(k, k.acct.meera, r(10));
  });
});
