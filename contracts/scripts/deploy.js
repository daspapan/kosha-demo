require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");
const { deployKosha } = require("./lib/deployKosha");
const { TIMELOCK_DELAY, PARTNER_ADDRESS, KEEPER_ADDRESS, COMMITTEE_ADDRESSES, RECONCILER_ADDRESS, ISSUER_ADDRESS } = process.env;

async function main() {
  const delay = Number(TIMELOCK_DELAY || (network.name === "sepolia" ? 600 : 86400));
  const local = ["hardhat", "localhost", "docker", "itest"].includes(network.name);
  const roles = local ? undefined : {
    partner: PARTNER_ADDRESS, keeper: KEEPER_ADDRESS,
    committee: (COMMITTEE_ADDRESSES || "").split(",").map((a) => a.trim()),
    reconciler: RECONCILER_ADDRESS, issuer: ISSUER_ADDRESS,
  };
  if (roles && (roles.committee.length !== 3 || Object.values(roles).flat().some((a) => !ethers.isAddress(a)))) {
    throw new Error("Set PARTNER_ADDRESS, KEEPER_ADDRESS, COMMITTEE_ADDRESSES (3, comma-separated), RECONCILER_ADDRESS, ISSUER_ADDRESS");
  }
  const k = await deployKosha({ timelockDelay: delay, roles, log: console.log });
  const out = { network: network.name, chainId: Number((await ethers.provider.getNetwork()).chainId), timelockDelay: delay };
  for (const name of ["eInr", "arc", "kyc", "gsec", "vault", "gateway", "timelock", "multisig"]) out[name] = await k[name].getAddress();
  out.deployBlock = await ethers.provider.getBlockNumber();
  fs.mkdirSync(path.join(__dirname, "..", "deployments"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "..", "deployments", `${network.name}.json`), JSON.stringify(out, null, 2));
  console.log(out);
}
main().catch((e) => { console.error(e); process.exit(1); });
