// Seeds the demo: 20 members deposit through the PartnerGateway (so the indexer and the
// partner bank ledger see every rupee), the issuer gets a coupon float, and the
// strategy APR is set from the latest dummy T-bill row.
// Local: roles are Hardhat accounts. Sepolia: PARTNER_PRIVATE_KEY, ISSUER_PRIVATE_KEY,
// MEMBER_PRIVATE_KEYS (comma-separated) and SEED_MEMBERS (default 5).
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

const DATA = path.join(__dirname, "..", "..", "data");
const r = (n) => ethers.parseUnits(String(n), 18);

function readCsv(file) {
  const [head, ...rows] = fs.readFileSync(path.join(DATA, file), "utf8").trim().split(/\r?\n/);
  const cols = head.split(",");
  return rows.map((line) => {
    const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"'));
    return Object.fromEntries(cols.map((c, i) => [c, cells[i]]));
  });
}

async function main() {
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", `${network.name}.json`), "utf8"));
  const at = (name, addr) => ethers.getContractAt(name, addr);
  const eInr = await at("MockERupee", dep.eInr);
  const kyc = await at("KycRegistry", dep.kyc);
  const gsec = await at("MockGsecStrategy", dep.gsec);
  const gateway = await at("PartnerGateway", dep.gateway);

  const local = ["hardhat", "localhost", "docker", "itest"].includes(network.name);
  const signers = await ethers.getSigners();
  const deployer = signers[0]; // mock RBI: mints eINR
  let partner, issuer, memberRows, memberSigners;
  const members = readCsv("members.csv").filter((m) => m.kyc === "verified");
  if (local) {
    partner = signers[1];
    issuer = signers[29];
    memberRows = members;
    memberSigners = members.map((m) => signers[Number(m.hardhat_account)]);
  } else {
    const p = ethers.provider;
    partner = new ethers.Wallet(process.env.PARTNER_PRIVATE_KEY, p);
    issuer = new ethers.Wallet(process.env.ISSUER_PRIVATE_KEY, p);
    const keys = (process.env.MEMBER_PRIVATE_KEYS || "").split(",").filter(Boolean);
    const n = Math.min(Number(process.env.SEED_MEMBERS || 5), keys.length);
    memberRows = members.slice(0, n);
    memberSigners = keys.slice(0, n).map((k) => new ethers.Wallet(k, p));
    await (await kyc.connect(partner).setVerifiedBatch([dep.gateway, issuer.address, ...memberSigners.map((s) => s.address)], true)).wait();
  }

  const tx = async (p) => (await p).wait();
  let total = 0n;
  for (let i = 0; i < memberRows.length; i++) {
    const m = memberRows[i], s = memberSigners[i];
    const amount = r(m.deposit_inr);
    await tx(eInr.connect(deployer).mint(s.address, amount + r(100000))); // Rs 1 lakh spare for repayments
    await tx(eInr.connect(s).approve(dep.gateway, amount));
    const id = await gateway.nextDepositId();
    await tx(gateway.connect(s).requestDeposit(amount, ethers.id(`seed-${m.member_id}`)));
    await tx(gateway.connect(partner).settleDeposit(id));
    total += amount;
    console.log(`${m.member_id} ${m.name.padEnd(18)} deposited Rs ${Number(m.deposit_inr).toLocaleString("en-IN")}`);
  }

  // Issuer coupon float: Rs 5 lakh of eINR swapped to mARC through the gateway
  await tx(eInr.connect(deployer).mint(issuer.address, r(500000)));
  await tx(eInr.connect(issuer).approve(dep.gateway, r(500000)));
  await tx(gateway.connect(issuer).cashIn(r(500000)));
  await tx((await at("MockARC", dep.arc)).connect(issuer).approve(dep.gsec, ethers.MaxUint256));

  const yields = readCsv("tbill_yields.csv");
  const latest = Number(yields[yields.length - 1].tbill_91d_yield_bps);
  await tx(gsec.connect(issuer).setAprBps(latest));

  console.log(`Seeded ${memberRows.length} members, TVL Rs ${ethers.formatUnits(total, 18)}; T-bill APR ${latest} bps`);
  dep.seededBlock = await ethers.provider.getBlockNumber();
  fs.writeFileSync(path.join(__dirname, "..", "deployments", `${network.name}.json`), JSON.stringify(dep, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
