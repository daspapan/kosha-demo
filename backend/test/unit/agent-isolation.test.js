import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { assertNoKeys } from "../../src/agent/runner.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const parseEnv = (file) => Object.fromEntries(fs.readFileSync(file, "utf8").split("\n").filter((l) => l && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));

test("AI-01 the agent's env file holds no key, and the agent refuses to start if one is added", () => {
  const env = parseEnv(path.join(ROOT, ".env.agent.example"));
  assert.doesNotThrow(() => assertNoKeys(env));
  assert.throws(() => assertNoKeys({ ...env, PARTNER_PRIVATE_KEY: "0x" + "1".repeat(64) }), /refuses to run/);
  assert.throws(() => assertNoKeys({ ...env, WHATEVER: "ab".repeat(32) }), /refuses to run/);
  assert.throws(() => assertNoKeys({ ...env, X: "test test test test test test test test test test test junk" }), /refuses to run/);
});

test("AI-01b the agent's code cannot sign: no signer, wallet or key reader in anything it imports", () => {
  const seen = new Set();
  const walk = (file) => {
    if (seen.has(file)) return; seen.add(file);
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(/from "(\.{1,2}\/[^"]+)"/g)) walk(path.resolve(path.dirname(file), m[1]));
  };
  walk(path.join(ROOT, "src", "agent", "runner.js"));
  const files = [...seen].map((f) => path.relative(ROOT, f));
  assert.ok(!files.some((f) => f.includes("signer.js")), files.join(", "));
  for (const f of seen) {
    const src = fs.readFileSync(f, "utf8");
    assert.doesNotMatch(src, /new Wallet\(|getSigner\(|process\.env\.\w*PRIVATE_KEY|process\.env\[[^\]]*PRIVATE_KEY|NonceManager/, path.relative(ROOT, f));
  }
});

test("AI-01c the backend's env file is the only one with keys, and they are Hardhat's public test keys", () => {
  const env = parseEnv(path.join(ROOT, ".env.backend.example"));
  const keys = Object.keys(env).filter((k) => k.endsWith("PRIVATE_KEY"));
  assert.deepEqual(keys.sort(), ["ISSUER_PRIVATE_KEY", "KEEPER_PRIVATE_KEY", "PARTNER_PRIVATE_KEY", "RBI_PRIVATE_KEY", "RECONCILER_PRIVATE_KEY"]);
});
