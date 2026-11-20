const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { baseFixture, ROLE, ADMIN, r } = require("./helpers");
const { deployKosha } = require("../scripts/lib/deployKosha");

describe("01 Deployment and roles", () => {
  it("D-01 deployer keeps no admin role; the timelock administers everything, itself included", async () => {
    const k = await loadFixture(baseFixture);
    const T = await k.timelock.getAddress();
    for (const c of [k.arc, k.kyc, k.gsec, k.vault, k.gateway, k.timelock]) {
      expect(await c.hasRole(ADMIN, k.acct.deployer.address)).to.equal(false);
      expect(await c.hasRole(ADMIN, T)).to.equal(true);
    }
  });

  it("D-02 only the gateway can mint mARC", async () => {
    const k = await loadFixture(baseFixture);
    for (const who of [k.acct.deployer, k.acct.partner, k.acct.attacker]) {
      await expect(k.arc.connect(who).mint(who.address, 1)).to.be.revertedWithCustomError(k.arc, "AccessControlUnauthorizedAccount");
    }
    expect(await k.arc.hasRole(ROLE("MINTER_ROLE"), await k.gateway.getAddress())).to.equal(true);
  });

  it("D-03 caps are compile-time constants", async () => {
    const k = await loadFixture(baseFixture);
    expect(await k.vault.BUFFER_MIN_BPS()).to.equal(1500);
    expect(await k.vault.GSEC_MAX_BPS()).to.equal(5000);
    expect(await k.vault.INVOICE_MAX_BPS()).to.equal(3500);
    expect(await k.vault.MEMBER_MAX_BPS()).to.equal(500);
  });

  it("D-04 timelock delay is 24 h and only the multisig can propose", async () => {
    const k = await loadFixture(baseFixture);
    expect(await k.timelock.getMinDelay()).to.equal(86400);
    expect(await k.timelock.hasRole(ROLE("PROPOSER_ROLE"), await k.multisig.getAddress())).to.equal(true);
    const [target, data] = [await k.vault.getAddress(), k.vault.interface.encodeFunctionData("allocateToGsec", [1])];
    await expect(k.timelock.connect(k.acct.committee[0]).schedule(target, 0, data, ethers.ZeroHash, ethers.ZeroHash, 86400))
      .to.be.revertedWithCustomError(k.timelock, "AccessControlUnauthorizedAccount");
  });

  it("D-05 only the timelock holds ALLOCATOR_ROLE and the strategy's vault is fixed", async () => {
    const k = await loadFixture(baseFixture);
    expect(await k.vault.hasRole(ROLE("ALLOCATOR_ROLE"), await k.timelock.getAddress())).to.equal(true);
    for (const who of [k.acct.deployer, k.acct.partner, k.acct.keeper, ...k.acct.committee]) {
      expect(await k.vault.hasRole(ROLE("ALLOCATOR_ROLE"), who.address)).to.equal(false);
    }
    await expect(k.gsec.connect(k.acct.deployer).setVault(k.acct.attacker.address))
      .to.be.revertedWithCustomError(k.gsec, "AccessControlUnauthorizedAccount");
    expect(await k.gsec.vault()).to.equal(await k.vault.getAddress());
  });

  it("D-06 multisig rejects duplicate or zero owners", async () => {
    const k = await loadFixture(baseFixture);
    const F = await ethers.getContractFactory("CommitteeMultisig");
    const a = k.acct.committee[0].address;
    await expect(F.deploy(await k.timelock.getAddress(), [a, a, k.acct.committee[1].address])).to.be.revertedWithCustomError(F, "BadOwners");
    await expect(F.deploy(await k.timelock.getAddress(), [a, ethers.ZeroAddress, k.acct.committee[1].address])).to.be.revertedWithCustomError(F, "BadOwners");
  });

  it("D-07 vault refuses a strategy with a different asset", async () => {
    const k = await loadFixture(baseFixture);
    const G = await ethers.getContractFactory("MockGsecStrategy");
    const wrong = await G.deploy(await k.eInr.getAddress(), k.acct.deployer.address, k.acct.issuer.address, 500);
    const V = await ethers.getContractFactory("KoshaVault");
    await expect(V.deploy(await k.arc.getAddress(), await k.kyc.getAddress(), await wrong.getAddress(), k.acct.deployer.address))
      .to.be.revertedWithCustomError(V, "AssetMismatch");
  });

  it("D-08 empty vault reports zero allocation without dividing by zero", async () => {
    const k = await loadFixture(baseFixture);
    const a = await k.vault.allocation();
    expect(a.total).to.equal(0);
    expect(await k.vault.totalAssets()).to.equal(0);
    expect(r(1)).to.be.gt(0);
  });

  it("D-09 public-network mode wires roles from plain addresses (Sepolia path)", async () => {
    const s = await ethers.getSigners();
    const roles = { partner: s[1].address, keeper: s[2].address, committee: [s[3].address, s[4].address, s[5].address], reconciler: s[28].address, issuer: s[29].address };
    const k = await deployKosha({ timelockDelay: 600, roles });
    expect(await k.timelock.getMinDelay()).to.equal(600);
    expect(await k.vault.hasRole(ROLE("PARTNER_ROLE"), roles.partner)).to.equal(true);
    expect(await k.vault.hasRole(ROLE("PAUSER_ROLE"), roles.reconciler)).to.equal(true);
    expect(await k.kyc.hasRole(ROLE("KYC_ADMIN_ROLE"), roles.partner)).to.equal(true);
    expect(await k.multisig.isOwner(roles.committee[2])).to.equal(true);
    expect(await k.vault.hasRole(ADMIN, s[0].address)).to.equal(false);
  });
});
