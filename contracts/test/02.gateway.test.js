const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { baseFixture, seededFixture, depositViaGateway, giveArc, r, DAY } = require("./helpers");

async function gatewayInvariant(k) {
  const held = await k.eInr.balanceOf(await k.gateway.getAddress());
  expect(held).to.equal((await k.arc.totalSupply()) + (await k.gateway.pendingDeposits()));
}

describe("02 PartnerGateway (e-Rupee in, ARC inside)", () => {
  it("G-01 an unverified wallet cannot request a deposit", async () => {
    const k = await loadFixture(baseFixture);
    const o = k.acct.outsider;
    await k.eInr.mint(o.address, r(1000));
    await k.eInr.connect(o).approve(await k.gateway.getAddress(), r(1000));
    await expect(k.gateway.connect(o).requestDeposit(r(1000), ethers.ZeroHash)).to.be.revertedWithCustomError(k.gateway, "NotVerified");
  });

  it("G-02 settlement mints mARC 1:1 and gives the member vault shares", async () => {
    const k = await loadFixture(baseFixture);
    const m = k.acct.meera;
    await depositViaGateway(k, m, r(1000000));
    expect(await k.vault.totalAssets()).to.equal(r(1000000));
    expect(await k.vault.convertToAssets(await k.vault.balanceOf(m.address))).to.equal(r(1000000));
    expect(await k.arc.totalSupply()).to.equal(r(1000000));
    await gatewayInvariant(k);
  });

  it("G-03 a request settles exactly once", async () => {
    const k = await loadFixture(baseFixture);
    const id = await depositViaGateway(k, k.acct.meera, r(100));
    await expect(k.gateway.connect(k.acct.partner).settleDeposit(id)).to.be.revertedWithCustomError(k.gateway, "NotPending");
    await expect(k.gateway.connect(k.acct.partner).rejectDeposit(id)).to.be.revertedWithCustomError(k.gateway, "NotPending");
  });

  it("G-04 a reused idempotency key is refused per member, not across members", async () => {
    const k = await loadFixture(baseFixture);
    const key = ethers.id("app-retry-123");
    await depositViaGateway(k, k.acct.meera, r(100), key);
    await k.eInr.mint(k.acct.meera.address, r(100));
    await k.eInr.connect(k.acct.meera).approve(await k.gateway.getAddress(), r(100));
    await expect(k.gateway.connect(k.acct.meera).requestDeposit(r(100), key)).to.be.revertedWithCustomError(k.gateway, "DuplicateRequest");
    await depositViaGateway(k, k.acct.members[1], r(100), key); // same key, other member: fine
  });

  it("G-05 only the partner settles or rejects", async () => {
    const k = await loadFixture(baseFixture);
    const m = k.acct.meera;
    await k.eInr.mint(m.address, r(100));
    await k.eInr.connect(m).approve(await k.gateway.getAddress(), r(100));
    await k.gateway.connect(m).requestDeposit(r(100), ethers.ZeroHash);
    for (const who of [m, k.acct.attacker, k.acct.keeper]) {
      await expect(k.gateway.connect(who).settleDeposit(1)).to.be.revertedWithCustomError(k.gateway, "AccessControlUnauthorizedAccount");
      await expect(k.gateway.connect(who).rejectDeposit(1)).to.be.revertedWithCustomError(k.gateway, "AccessControlUnauthorizedAccount");
    }
  });

  it("G-06 a rejected deposit refunds the e-Rupee", async () => {
    const k = await loadFixture(baseFixture);
    const m = k.acct.meera;
    await k.eInr.mint(m.address, r(100));
    await k.eInr.connect(m).approve(await k.gateway.getAddress(), r(100));
    await k.gateway.connect(m).requestDeposit(r(100), ethers.ZeroHash);
    await k.gateway.connect(k.acct.partner).rejectDeposit(1);
    expect(await k.eInr.balanceOf(m.address)).to.equal(r(100));
    await gatewayInvariant(k);
  });

  it("G-07 if the partner goes silent, the member can cancel after 3 days", async () => {
    const k = await loadFixture(baseFixture);
    const m = k.acct.meera;
    await k.eInr.mint(m.address, r(100));
    await k.eInr.connect(m).approve(await k.gateway.getAddress(), r(100));
    await k.gateway.connect(m).requestDeposit(r(100), ethers.ZeroHash);
    await expect(k.gateway.connect(m).cancelDeposit(1)).to.be.revertedWithCustomError(k.gateway, "TooEarly");
    await time.increase(3 * DAY);
    await expect(k.gateway.connect(k.acct.attacker).cancelDeposit(1)).to.be.revertedWithCustomError(k.gateway, "NotRequester");
    await k.gateway.connect(m).cancelDeposit(1);
    expect(await k.eInr.balanceOf(m.address)).to.equal(r(100));
    await gatewayInvariant(k);
  });

  it("G-08 cash-in needs KYC; cash-out never does, so a revoked member can always exit", async () => {
    const k = await loadFixture(baseFixture);
    const m = k.acct.meera;
    await giveArc(k, m, r(500));
    await k.kyc.connect(k.acct.partner).setVerified(m.address, false);
    await k.eInr.mint(m.address, r(1));
    await k.eInr.connect(m).approve(await k.gateway.getAddress(), r(1));
    await expect(k.gateway.connect(m).cashIn(r(1))).to.be.revertedWithCustomError(k.gateway, "NotVerified");
    await k.arc.connect(m).approve(await k.gateway.getAddress(), r(500));
    await k.gateway.connect(m).cashOut(r(500));
    expect(await k.eInr.balanceOf(m.address)).to.equal(r(501));
    await gatewayInvariant(k);
  });

  it("G-09 zero amounts are refused", async () => {
    const k = await loadFixture(baseFixture);
    await expect(k.gateway.connect(k.acct.meera).requestDeposit(0, ethers.ZeroHash)).to.be.revertedWithCustomError(k.gateway, "ZeroAmount");
    await expect(k.gateway.connect(k.acct.meera).cashIn(0)).to.be.revertedWithCustomError(k.gateway, "ZeroAmount");
    await expect(k.gateway.connect(k.acct.meera).cashOut(0)).to.be.revertedWithCustomError(k.gateway, "ZeroAmount");
  });

  it("G-10 reserve invariant holds across a mixed flow: eINR held = mARC supply + pending", async () => {
    const k = await loadFixture(seededFixture);
    const m = k.acct.meera;
    await k.eInr.mint(m.address, r(300));
    await k.eInr.connect(m).approve(await k.gateway.getAddress(), r(300));
    await k.gateway.connect(m).requestDeposit(r(200), ethers.ZeroHash); // stays pending
    await k.gateway.connect(m).cashIn(r(100));
    await k.vault.connect(m).redeem(await k.vault.maxRedeem(m.address) / 2n, m.address, m.address);
    const bal = await k.arc.balanceOf(m.address);
    await k.arc.connect(m).approve(await k.gateway.getAddress(), bal);
    await k.gateway.connect(m).cashOut(bal);
    await gatewayInvariant(k);
  });
});
