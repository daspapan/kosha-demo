// Boots a private Hardhat chain on :8655, deploys + seeds it, and builds a backend against it.
// Each integration file gets a fresh chain, a temp data dir and a temp database.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { Wallet, HDNodeWallet, Mnemonic, JsonRpcProvider } from "ethers";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const CONTRACTS = path.join(ROOT, "contracts");
const MNEMONIC = Mnemonic.fromPhrase("test test test test test test test test test test test junk");
export const key = (i) => HDNodeWallet.fromMnemonic(MNEMONIC, `m/44'/60'/0'/0/${i}`).privateKey;
export const RPC = "http://127.0.0.1:8655";

async function waitRpc(url, ms = 60000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    try { const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' }); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("hardhat node did not start");
}

export async function bootEnv({ ollamaUrl }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kosha-it-"));
  const dataDir = path.join(tmp, "data");
  fs.cpSync(path.join(ROOT, "data"), dataDir, { recursive: true });
  const node = spawn("npx", ["hardhat", "node", "--port", "8655"], { cwd: CONTRACTS, env: { ...process.env }, stdio: "ignore", detached: true });
  const kill = () => { try { process.kill(-node.pid); } catch {} };
  try {
    await waitRpc(RPC);
    for (const script of ["scripts/deploy.js", "scripts/seed.js"]) {
      const r = spawnSync("npx", ["hardhat", "run", script, "--network", "itest"], { cwd: CONTRACTS, env: { ...process.env }, encoding: "utf8" });
      if (r.status !== 0) throw new Error(`${script} failed: ${r.stderr || r.stdout}`);
    }
  } catch (e) { kill(); throw e; }
  Object.assign(process.env, {
    DATA_DIR: dataDir, NETWORK: "itest", RPC_URL: RPC, CHAOS_PORT: "8656", RPC_URL_B: "http://127.0.0.1:8656", DB_PATH: path.join(tmp, "kosha.db"),
    OLLAMA_URL: ollamaUrl, AGENT_TOKEN: "test-agent-token", RBI_PRIVATE_KEY: key(0), PARTNER_PRIVATE_KEY: key(1), KEEPER_PRIVATE_KEY: key(2),
    RECONCILER_PRIVATE_KEY: key(28), ISSUER_PRIVATE_KEY: key(29),
  });
  const { createKosha } = await import("../../src/app.js");
  const ctx = await createKosha();
  const server = await new Promise((resolve) => { const s = ctx.app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const provider = new JsonRpcProvider(RPC, undefined, { staticNetwork: true, cacheTimeout: -1 });
  const api = async (method, p, { token, body, headers = {}, form } = {}) => {
    const h = { ...headers };
    if (token) h.authorization = `Bearer ${token}`;
    if (body !== undefined) h["content-type"] = "application/json";
    const res = await fetch(base + "/api" + p, { method, headers: h, body: form ?? (body !== undefined ? JSON.stringify(body) : undefined) });
    const text = await res.text();
    let json; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: res.status, body: json };
  };
  const login = async (i) => {
    const w = new Wallet(key(i));
    const { body: n } = await api("POST", "/auth/nonce", { body: { address: w.address } });
    const { body } = await api("POST", "/auth/verify", { body: { address: w.address, signature: await w.signMessage(n.message) } });
    return body.token;
  };
  const wallet = (i) => new Wallet(key(i), provider);
  return {
    ctx, api, login, wallet, provider, dataDir, base,
    close: async () => { server.close(); await ctx.close(); provider.destroy(); kill(); fs.rmSync(tmp, { recursive: true, force: true }); },
  };
}
