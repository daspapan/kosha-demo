// Reads the dummy data files and maps members to wallet addresses.
import fs from "node:fs";
import path from "node:path";
import { HDNodeWallet, Mnemonic, getAddress } from "ethers";
import { config } from "./config.js";

export const DATA_DIR = config.dataDir;
const HARDHAT_MNEMONIC = "test test test test test test test test test test test junk";

export function readCsv(file) {
  const [head, ...rows] = fs.readFileSync(path.join(DATA_DIR, file), "utf8").trim().split(/\r?\n/);
  const cols = head.split(",");
  return rows.map((line) => {
    const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"'));
    return Object.fromEntries(cols.map((c, i) => [c, cells[i]]));
  });
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf8"));
}

/** Hardhat account address for an index (public test mnemonic; worthless outside the demo). */
export function hardhatAddress(index) {
  const m = Mnemonic.fromPhrase(HARDHAT_MNEMONIC);
  return HDNodeWallet.fromMnemonic(m, `m/44'/60'/0'/0/${index}`).address;
}

let cache;
export function registry() {
  if (cache) return cache;
  const members = readCsv("members.csv").map((m) => ({
    ...m,
    address: m.address ? getAddress(m.address) : hardhatAddress(Number(m.hardhat_account)),
    deposit_inr: Number(m.deposit_inr),
  }));
  const exporters = readCsv("exporters.csv");
  const gstr1 = readCsv("invoices.csv").filter((i) => i.in_gstr1 === "yes"); // mock GSTR-1 filings
  const policy = readJson("policy.json");
  const byAddress = new Map(members.map((m) => [m.address.toLowerCase(), m]));
  const byGstin = new Map(members.filter((m) => m.gstin !== "n/a").map((m) => [m.gstin, m]));
  cache = { members, exporters, gstr1, policy, byAddress, byGstin };
  return cache;
}

export function resetRegistryCache() { cache = undefined; }
