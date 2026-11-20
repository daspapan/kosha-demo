const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { seededFixture, giveArc, r } = require("./helpers");

describe("03 Vault shares are KYC-gated", () => {
  it("K-01 shares cannot move to an unverified wallet", async () => {
    const k = await loadFixture(seededFixture);
    await expect(k.vault.connect(k.acct.meera).transfer(k.acct.outsider.address, 1))
      .to.be.revertedWithCustomError(k.vault, "NotVerified").withArgs(k.acct.outsider.address);
  });

  it("K-02 shares move freely between verified members", async () => {
    const k = await loadFixture(seededFixture);
    const [a, b] = k.acct.members;
    const before = await k.vault.balanceOf(b.address);
    await k.vault.connect(a).transfer(b.address, 1000);
    expect(await k.vault.balanceOf(b.address)).to.equal(before + 1000n);
  });

  it("K-03 a verified member can deposit directly; an outsider holding mARC cannot", async () => {
    const k = await loadFixture(seededFixture);
    const m = k.acct.meera, o = k.acct.outsider;
    await giveArc(k, m, r(1000));
    await k.arc.connect(m).approve(await k.vault.getAddress(), r(1000));
    await k.vault.connect(m).deposit(r(500), m.address);
    await k.arc.connect(m).transfer(o.address, r(500)); // mARC itself is not gated
    await k.arc.connect(o).approve(await k.vault.getAddress(), r(500));
    await expect(k.vault.connect(o).deposit(r(500), o.address)).to.be.revertedWithCustomError(k.vault, "ERC4626ExceededMaxDeposit");
    await expect(k.vault.connect(o).deposit(r(500), m.address)).to.be.revertedWithCustomError(k.vault, "NotVerified").withArgs(o.address);
  });

  it("K-04 a member whose KYC lapses cannot transfer, but can still redeem and request redemption", async () => {
    const k = await loadFixture(seededFixture);
    const m = k.acct.meera;
    await k.kyc.connect(k.acct.partner).setVerified(m.address, false);
    await expect(k.vault.connect(m).transfer(k.acct.members[1].address, 1)).to.be.revertedWithCustomError(k.vault, "NotVerified");
    await k.vault.connect(m).redeem(r(100), m.address, m.address);
    await k.vault.connect(m).requestRedeem(r(100));
    await k.vault.connect(m).cancelRedeem(1);
  });

  it("K-05 withdrawing to someone else requires a verified receiver", async () => {
    const k = await loadFixture(seededFixture);
    const m = k.acct.meera;
    await expect(k.vault.connect(m).withdraw(r(10), k.acct.outsider.address, m.address))
      .to.be.revertedWithCustomError(k.vault, "ReceiverNotVerified");
    await k.vault.connect(m).withdraw(r(10), k.acct.members[1].address, m.address);
  });

  it("K-06 zero-asset deposits are refused", async () => {
    const k = await loadFixture(seededFixture);
    await expect(k.vault.connect(k.acct.meera).deposit(0, k.acct.meera.address)).to.be.revertedWithCustomError(k.vault, "ZeroAmount");
  });
});
