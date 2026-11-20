// Shared by scripts/deploy.js and every test, so tests exercise the exact production wiring.
const { ethers } = require("hardhat");

const ROLE = (name) => ethers.keccak256(ethers.toUtf8Bytes(name));
const ADMIN = ethers.ZeroHash;

/**
 * Local (hardhat/localhost): every role is a Hardhat account (#0..#29).
 * Public networks: pass `roles` with addresses; only the deployer key is needed here,
 * and member KYC is done later by scripts/seed.js with the partner key.
 */
async function deployKosha({ timelockDelay = 24 * 3600, tbillAprBps = 550, roles, log = () => {} } = {}) {
  const s = await ethers.getSigners();
  const acct = roles
    ? { deployer: s[0], partner: { address: roles.partner }, keeper: { address: roles.keeper },
        committee: roles.committee.map((a) => ({ address: a })), members: [],
        reconciler: { address: roles.reconciler }, issuer: { address: roles.issuer } }
    : {
        deployer: s[0], partner: s[1], keeper: s[2],
        committee: [s[3], s[4], s[5]],
        members: s.slice(6, 26), meera: s[6],
        outsider: s[26], attacker: s[27], reconciler: s[28], issuer: s[29],
      };
  const d = acct.deployer.address;
  const deploy = async (name, ...args) => {
    const c = await (await ethers.getContractFactory(name)).deploy(...args);
    await c.waitForDeployment();
    log(`${name} ${await c.getAddress()}`);
    return c;
  };

  const eInr = await deploy("MockERupee", d);
  const arc = await deploy("MockARC", d);
  const kyc = await deploy("KycRegistry", d);
  const gsec = await deploy("MockGsecStrategy", await arc.getAddress(), d, acct.issuer.address, tbillAprBps);
  const vault = await deploy("KoshaVault", await arc.getAddress(), await kyc.getAddress(), await gsec.getAddress(), d);
  const gateway = await deploy("PartnerGateway", await eInr.getAddress(), await arc.getAddress(),
    await vault.getAddress(), await kyc.getAddress(), d, acct.partner.address);
  const timelock = await deploy("KoshaTimelock", timelockDelay, [], [ethers.ZeroAddress], d);
  const multisig = await deploy("CommitteeMultisig", await timelock.getAddress(), acct.committee.map((c) => c.address));

  const T = await timelock.getAddress();
  const tx = async (p) => (await p).wait();

  // Tokens and registry
  await tx(arc.grantRole(ROLE("MINTER_ROLE"), await gateway.getAddress()));
  await tx(kyc.grantRole(ROLE("KYC_ADMIN_ROLE"), acct.partner.address));
  await tx(gsec.setVault(await vault.getAddress()));

  // Vault roles
  await tx(vault.grantRole(ROLE("ALLOCATOR_ROLE"), T));
  await tx(vault.grantRole(ROLE("PARTNER_ROLE"), acct.partner.address));
  await tx(vault.grantRole(ROLE("KEEPER_ROLE"), acct.keeper.address));
  for (const p of [...acct.committee, acct.reconciler]) await tx(vault.grantRole(ROLE("PAUSER_ROLE"), p.address));

  // Timelock: only the multisig proposes and cancels
  await tx(timelock.grantRole(ROLE("PROPOSER_ROLE"), await multisig.getAddress()));
  await tx(timelock.grantRole(ROLE("CANCELLER_ROLE"), await multisig.getAddress()));

  // KYC: partner verifies the gateway, the issuer and the members (locally; on public networks seed.js does it)
  if (!roles) {
    await tx(kyc.connect(acct.partner).setVerifiedBatch(
      [await gateway.getAddress(), acct.issuer.address, ...acct.members.map((m) => m.address)], true));
  }

  // Hand every admin role to the timelock, then the deployer walks away
  for (const c of [arc, kyc, gsec, vault, gateway]) {
    await tx(c.grantRole(ADMIN, T));
    await tx(c.renounceRole(ADMIN, d));
  }
  await tx(timelock.renounceRole(ADMIN, d));

  return { acct, eInr, arc, kyc, gsec, vault, gateway, timelock, multisig };
}

module.exports = { deployKosha, ROLE, ADMIN };
