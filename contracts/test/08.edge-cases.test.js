const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { baseFixture, seededFixture, schedule, govern, vaultCall, giveArc, openLoan, r, DAY } = require("./helpers");

describe("08 Edge cases and input validation", () => {
  it("E-01 ERC-4626 mint path is gated exactly like deposit", async () => {
    const k = await loadFixture(seededFixture);
    const m = k.acct.meera;
    await giveArc(k, m, r(1000));
    await k.arc.connect(m).approve(await k.vault.getAddress(), r(1000));
    expect(await k.vault.maxMint(k.acct.outsider.address)).to.equal(0);
    await expect(k.vault.connect(m).mint(r(1), k.acct.outsider.address)).to.be.revertedWithCustomError(k.vault, "ERC4626ExceededMaxMint");
    await k.vault.connect(m).mint(r(100), m.address);
    await k.vault.connect(k.acct.reconciler).pause();
    expect(await k.vault.maxMint(m.address)).to.equal(0);
  });

  it("E-02 constructors reject zero addresses", async () => {
    const k = await loadFixture(baseFixture);
    const Z = ethers.ZeroAddress, d = k.acct.deployer.address;
    const G = await ethers.getContractFactory("MockGsecStrategy");
    await expect(G.deploy(Z, d, d, 100)).to.be.revertedWithCustomError(G, "ZeroAddress");
    await expect(G.deploy(await k.arc.getAddress(), d, d, 2001)).to.be.revertedWithCustomError(G, "AprTooHigh");
    const V = await ethers.getContractFactory("KoshaVault");
    await expect(V.deploy(await k.arc.getAddress(), Z, await k.gsec.getAddress(), d)).to.be.revertedWithCustomError(V, "ZeroAddress");
    const P = await ethers.getContractFactory("PartnerGateway");
    await expect(P.deploy(Z, await k.arc.getAddress(), await k.vault.getAddress(), await k.kyc.getAddress(), d, d)).to.be.revertedWithCustomError(P, "ZeroAddress");
    await expect(k.kyc.connect(k.acct.partner).setVerified(Z, true)).to.be.revertedWithCustomError(k.kyc, "ZeroAddress");
  });

  it("E-03 strategy refuses zero amounts and a zero vault", async () => {
    const k = await loadFixture(seededFixture);
    await expect(k.gsec.payCoupon(0)).to.be.revertedWithCustomError(k.gsec, "ZeroAmount");
    await expect(k.vault.connect(k.acct.keeper).requestFromGsec(0)).to.be.revertedWithCustomError(k.gsec, "ZeroAmount");
    await expect(govern(k, ...(await vaultCall(k, "allocateToGsec", [0])))).to.be.revertedWithCustomError(k.vault, "ZeroAmount");
    const G = await ethers.getContractFactory("MockGsecStrategy");
    const g = await G.deploy(await k.arc.getAddress(), k.acct.deployer.address, k.acct.issuer.address, 100);
    await expect(g.setVault(ethers.ZeroAddress)).to.be.revertedWithCustomError(g, "ZeroAddress");
  });

  it("E-04 allocation larger than idle money is refused with the available amount", async () => {
    const k = await loadFixture(seededFixture);
    await expect(govern(k, ...(await vaultCall(k, "allocateToGsec", [r(10000001)])))).to.be.revertedWithCustomError(k.vault, "InsufficientLiquidity");
  });

  it("E-05 multisig edge paths: revoke without vote, unknown cancel, cancel after execution, bad owner swap", async () => {
    const k = await loadFixture(seededFixture);
    const [c0, c1, c2] = k.acct.committee;
    const [target, data] = await vaultCall(k, "allocateToGsec", [r(1000)]);
    await k.multisig.connect(c0).submit(target, 0, data, ethers.id("a"), ethers.id("p"));
    await expect(k.multisig.connect(c1).revoke(1)).to.be.revertedWithCustomError(k.multisig, "NotConfirmed");
    await k.multisig.connect(c1).cancel(1); // unscheduled cancel
    await expect(k.multisig.connect(c2).confirm(1)).to.be.revertedWithCustomError(k.multisig, "ProposalClosed");
    await expect(k.multisig.connect(c2).cancel(77)).to.be.revertedWithCustomError(k.multisig, "UnknownProposal");
    const op = await govern(k, target, data);
    await expect(k.multisig.connect(c0).cancel(op.id)).to.be.revertedWithCustomError(k.multisig, "ProposalClosed");
    const bad = k.multisig.interface.encodeFunctionData("replaceOwner", [k.acct.attacker.address, k.acct.issuer.address]);
    await expect(govern(k, await k.multisig.getAddress(), bad)).to.be.revertedWithCustomError(k.multisig, "BadOwners");
  });

  it("E-06 loan views and status checks on unknown loans", async () => {
    const k = await loadFixture(seededFixture);
    expect(await k.vault.interestDue(99)).to.equal(0);
    await expect(k.vault.repayLoan(99)).to.be.revertedWithCustomError(k.vault, "BadLoanStatus");
    await expect(k.vault.connect(k.acct.partner).writeOffLoan(99)).to.be.revertedWithCustomError(k.vault, "BadLoanStatus");
    const id = await openLoan(k, k.acct.meera, r(100), { days: 1 });
    await giveArc(k, k.acct.meera, r(1));
    await k.arc.connect(k.acct.meera).approve(await k.vault.getAddress(), r(101));
    await k.vault.connect(k.acct.meera).repayLoan(id);
    expect(await k.vault.interestDue(id)).to.equal(0);
    await expect(k.vault.connect(k.acct.partner).writeOffLoan(id)).to.be.revertedWithCustomError(k.vault, "BadLoanStatus");
  });

  it("E-07 redemption requests: zero shares, unknown ids, more shares than held", async () => {
    const k = await loadFixture(seededFixture);
    const m = k.acct.meera;
    await expect(k.vault.connect(m).requestRedeem(0)).to.be.revertedWithCustomError(k.vault, "ZeroAmount");
    await expect(k.vault.connect(m).requestRedeem((await k.vault.balanceOf(m.address)) + 1n)).to.be.revertedWithCustomError(k.vault, "ERC20InsufficientBalance");
    await expect(k.vault.fulfilRedeem(5)).to.be.revertedWithCustomError(k.vault, "BadRedeemStatus");
    await expect(k.vault.connect(m).claimRedeem(5)).to.be.revertedWithCustomError(k.vault, "NotRequestOwner");
    await k.vault.connect(m).requestRedeem(r(1));
    await expect(k.vault.connect(m).claimRedeem(1)).to.be.revertedWithCustomError(k.vault, "BadRedeemStatus"); // not fulfilled yet
  });

  it("E-08 KYC batch revoke and re-verify are logged as events", async () => {
    const k = await loadFixture(seededFixture);
    const addrs = k.acct.members.slice(0, 3).map((m) => m.address);
    await expect(k.kyc.connect(k.acct.partner).setVerifiedBatch(addrs, false)).to.emit(k.kyc, "KycSet").withArgs(addrs[0], false);
    expect(await k.kyc.isVerified(addrs[1])).to.equal(false);
    await k.kyc.connect(k.acct.partner).setVerifiedBatch(addrs, true);
    expect(await k.kyc.isVerified(addrs[2])).to.equal(true);
  });

  it("E-09 a second G-sec request restarts the T+1 clock for the whole pending amount", async () => {
    const k = await loadFixture(seededFixture);
    await govern(k, ...(await vaultCall(k, "allocateToGsec", [r(1000000)])));
    await k.vault.connect(k.acct.keeper).requestFromGsec(r(100));
    await time.increase(DAY - 100);
    await k.vault.connect(k.acct.keeper).requestFromGsec(r(100));
    await time.increase(200);
    await expect(k.vault.claimFromGsec()).to.be.revertedWithCustomError(k.gsec, "NotReady");
    await time.increase(DAY);
    await k.vault.claimFromGsec();
    expect(await k.gsec.totalValue()).to.equal(r(999800));
  });
});
