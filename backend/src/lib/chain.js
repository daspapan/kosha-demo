// Contract handles. ABIs come straight from the Hardhat artifacts, addresses from deployments/<network>.json.
import fs from "node:fs";
import path from "node:path";
import { Contract, JsonRpcProvider, Interface } from "ethers";
import { config } from "./config.js";

const ARTIFACTS = {
  eInr: "tokens/MockERupee.sol/MockERupee.json",
  arc: "tokens/MockARC.sol/MockARC.json",
  kyc: "KycRegistry.sol/KycRegistry.json",
  gsec: "strategies/MockGsecStrategy.sol/MockGsecStrategy.json",
  vault: "KoshaVault.sol/KoshaVault.json",
  gateway: "PartnerGateway.sol/PartnerGateway.json",
  timelock: "governance/KoshaTimelock.sol/KoshaTimelock.json",
  multisig: "governance/CommitteeMultisig.sol/CommitteeMultisig.json",
};
export const CONTRACT_NAMES = Object.keys(ARTIFACTS);

let abis;
export function loadAbis() {
  if (abis) return abis;
  abis = {};
  for (const [k, rel] of Object.entries(ARTIFACTS)) {
    abis[k] = JSON.parse(fs.readFileSync(path.join(config.artifactsDir, rel), "utf8")).abi;
  }
  return abis;
}

export function loadDeployment(network = config.network) {
  return JSON.parse(fs.readFileSync(path.join(config.deploymentsDir, `${network}.json`), "utf8"));
}

export function makeProvider(url = config.rpcUrl) {
  return new JsonRpcProvider(url, undefined, { staticNetwork: true, polling: true, pollingInterval: 1000, cacheTimeout: -1 });
}

/** Returns { eInr, arc, ..., addresses, interfaces } bound to a provider or signer. */
export function contractsFor(runner, deployment = loadDeployment()) {
  const a = loadAbis();
  const out = { addresses: {}, interfaces: {} };
  for (const k of CONTRACT_NAMES) {
    out[k] = new Contract(deployment[k], a[k], runner);
    out.addresses[k] = deployment[k];
    out.interfaces[k] = new Interface(a[k]);
  }
  out.deployment = deployment;
  return out;
}
