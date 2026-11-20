const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { deployKosha, ROLE, ADMIN } = require("../scripts/lib/deployKosha");

const r = (n) => ethers.parseUnits(String(n), 18); // 1 token = Rs 1
const DAY = 24 * 3600;

async function depositViaGateway(k, member, amount, key = ethers.ZeroHash) {
  await k.eInr.connect(k.acct.deployer).mint(member.address, amount);
  await k.eInr.connect(member).approve(await k.gateway.getAddress(), amount);
  const id = await k.gateway.nextDepositId();
  await k.gateway.connect(member).requestDeposit(amount, key);
  await k.gateway.connect(k.acct.partner).settleDeposit(id);
  return id;
}

/// Fresh deployment, no deposits.
async function baseFixture() {
  return deployKosha();
}

/// 20 members x Rs 5,00,000 = Rs 1,00,00,000 TVL. Caps: 5% = 5L, 15% = 15L, 35% = 35L, 50% = 50L.
async function seededFixture() {
  const k = await deployKosha();
  for (const m of k.acct.members) await depositViaGateway(k, m, r(500000));
  return k;
}

/// Gives an account mARC through the gateway (KYC required for cashIn).
async function giveArc(k, who, amount) {
  await k.eInr.connect(k.acct.deployer).mint(who.address, amount);
  await k.eInr.connect(who).approve(await k.gateway.getAddress(), amount);
  await k.gateway.connect(who).cashIn(amount);
}

/// Full governance path: submit + confirm (2-of-3) + wait + execute.
async function schedule(k, target, data, signers = [0, 1], proposalHash = ethers.id("proposal")) {
  const salt = ethers.hexlify(ethers.randomBytes(32));
  const id = await k.multisig.nextProposalId();
  await k.multisig.connect(k.acct.committee[signers[0]]).submit(target, 0, data, salt, proposalHash);
  await k.multisig.connect(k.acct.committee[signers[1]]).confirm(id);
  return { id, salt, target, data };
}

async function govern(k, target, data, signers) {
  const op = await schedule(k, target, data, signers);
  await time.increase(DAY);
  await k.timelock.execute(target, 0, data, ethers.ZeroHash, op.salt);
  return op;
}

async function vaultCall(k, fn, args = []) {
  return [await k.vault.getAddress(), k.vault.interface.encodeFunctionData(fn, args)];
}

let invoiceCounter = 0;
const invoiceHash = (label) => ethers.id(`INV-${label ?? ++invoiceCounter}`);

async function openLoan(k, borrower, amount, { days = 60, rateBps = 1200, inv } = {}) {
  const due = (await time.latest()) + days * DAY;
  const id = await k.vault.nextLoanId();
  await k.vault.connect(k.acct.partner).openLoan(borrower.address, amount, rateBps, due, inv ?? invoiceHash());
  return id;
}

module.exports = { r, DAY, ROLE, ADMIN, depositViaGateway, baseFixture, seededFixture, giveArc, schedule, govern, vaultCall, openLoan, invoiceHash };
