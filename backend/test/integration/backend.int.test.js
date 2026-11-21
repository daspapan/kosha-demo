// Backend integration tests against a real Hardhat chain (deployed + seeded) and a stand-in Ollama.
// Runs in order: each test builds on the state the previous one left, like the demo itself.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { Contract, parseUnits, ZeroHash, id as keccakId } from "ethers";
import { startFakeOllama } from "../helpers/fake-ollama.js";
import { bootEnv } from "../helpers/env.js";

const r = (n) => parseUnits(String(n), 18);
const DAY = 86400;
let env, ollama, T; // T = tokens by role
const A = { partner: 1, keeper: 2, prakash: 3, sasmita: 4, rakesh: 5, meera: 6, lipika: 8, debasis: 9, pratima: 10, ashok: 11, kalpana: 12, gopal: 17, nirmal: 23, outsider: 26 };
const state = {};

const on = (i, name) => env.ctx.c[name].connect(env.wallet(i));
const upload = async (who, inv) => {
  const fd = new FormData();
  fd.append("file", new Blob([fs.readFileSync(path.join(env.dataDir, "invoices", `${inv}.pdf`))], { type: "application/pdf" }), `${inv}.pdf`);
  return env.api("POST", "/invoices", { token: T[who], form: fd });
};
const reconcile = async () => (await env.api("POST", "/ops/reconcile")).body;
const travel = (seconds) => env.api("POST", "/ops/time-travel", { body: { seconds } });
const keeper = async () => (await env.api("POST", "/ops/keeper")).body.did;
const runAgent = async () => (await import("../../src/agent/runner.js")).runOnce({ provider: env.ctx.provider, c: env.ctx.c, backendUrl: env.base, token: "test-agent-token", ollama: { url: ollama.url } });
async function govern(data, target = env.ctx.c.addresses.vault, label = "x") {
  const salt = keccakId(`${label}-${Date.now()}`);
  const id = await env.ctx.c.multisig.nextProposalId();
  await (await on(A.prakash, "multisig").submit(target, 0, data, salt, keccakId(label))).wait();
  await (await on(A.sasmita, "multisig").confirm(id)).wait();
  await travel(DAY);
  return keeper();
}

before(async () => {
  ollama = await startFakeOllama();
  env = await bootEnv({ ollamaUrl: ollama.url });
  T = {};
  for (const [k, i] of Object.entries(A)) T[k] = await env.login(i);
}, { timeout: 180000 });
after(async () => { await env?.close(); await ollama?.close(); });

test("REC-01 a freshly seeded pool reconciles: chain, ledger, bank ledger and both RPCs agree", async () => {
  const out = await reconcile();
  assert.equal(out.ok, true, JSON.stringify(out.details));
  assert.equal(out.details.length, 4);
  const pool = (await env.api("GET", "/pool")).body;
  assert.equal(pool.tvl, 12000000);
  assert.deepEqual(pool.allocation, { bufferBps: 10000, gsecBps: 0, invoiceBps: 0 });
  assert.equal(pool.redemptions.expected7d, 1027000);
});

test("Sign-in reads roles from the chain; a bad signature is refused", async () => {
  const me = (await env.api("GET", "/me", { token: T.meera })).body;
  assert.equal(me.roles.member, true);
  assert.equal(me.member.member_id, "M01");
  assert.equal(me.roles.partner, false);
  const partner = (await env.api("GET", "/me", { token: T.partner })).body;
  assert.equal(partner.roles.partner, true);
  const w = env.wallet(A.meera);
  const { body: n } = await env.api("POST", "/auth/nonce", { body: { address: w.address } });
  const bad = await env.api("POST", "/auth/verify", { body: { address: w.address, signature: await env.wallet(A.outsider).signMessage(n.message) } });
  assert.equal(bad.status, 401);
  assert.equal((await env.api("GET", "/partner/queue", { token: T.meera })).status, 403);
  assert.equal((await env.api("GET", "/me")).status, 401);
});

test("INT-01 deposit intent, requestDeposit, partner settles: indexer row, bank ledger row, shares minted", async () => {
  const { body: intent } = await env.api("POST", "/deposits/intent", { token: T.meera });
  assert.match(intent.clientKey, /^0x[0-9a-f]{64}$/);
  const before = await env.ctx.c.vault.balanceOf(env.wallet(A.meera).address);
  await (await on(A.meera, "eInr").approve(intent.gateway, r(50000))).wait();
  const rc = await (await on(A.meera, "gateway").requestDeposit(r(50000), intent.clientKey)).wait();
  const q = (await env.api("GET", "/partner/queue", { token: T.partner })).body;
  const dep = q.deposits.find((d) => d.member === env.wallet(A.meera).address);
  assert.equal(dep.amount, 50000);
  const s = await env.api("POST", `/partner/deposits/${dep.id}/settle`, { token: T.partner });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  state.depositId = dep.id; state.settleTx = s.body.txHash;
  assert.ok((await env.ctx.c.vault.balanceOf(env.wallet(A.meera).address)) > before);
  await reconcile();
  const db = env.ctx.db;
  assert.equal(db.prepare("SELECT COUNT(*) n FROM ledger_events WHERE event = 'DepositSettled' AND json_extract(args, '$.id') = ?").get(String(dep.id)).n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM partner_bank_ledger WHERE tx_hash = ? AND direction = 'in'").get(rc.hash).n, 1);
  const me = (await env.api("GET", "/me", { token: T.meera })).body;
  assert.equal(me.deposits.find((d) => d.id === dep.id).status, "Settled");
  assert.ok(me.statement.some((e) => e.txHash === state.settleTx));
});

test("INT-02 a retried settle returns the first result and sends no second transaction", async () => {
  const again = await env.api("POST", `/partner/deposits/${state.depositId}/settle`, { token: T.partner });
  assert.equal(again.status, 200);
  assert.equal(again.body.replayed, true);
  assert.equal(again.body.txHash, state.settleTx);
  const rej = await env.api("POST", `/partner/deposits/${state.depositId}/reject`, { token: T.partner });
  assert.equal(rej.status, 409);
});

test("INT-03 INV-01 is verified and becomes a Rs 2,00,000 loan with its invoice hash on-chain", async () => {
  const up = await upload("meera", "INV-01");
  assert.equal(up.status, 201);
  assert.equal(up.body.status, "verified", JSON.stringify(up.body.checks));
  assert.ok(up.body.checks.every((k) => k.ok));
  assert.equal(up.body.guard.flagged, false);
  assert.equal(up.body.principal, 200000);
  const ap = await env.api("POST", `/partner/invoices/${up.body.id}/approve`, { token: T.partner });
  assert.equal(ap.status, 200, JSON.stringify(ap.body));
  const loan = await env.ctx.c.vault.loans(ap.body.loanId);
  assert.equal(loan.principal, r(200000));
  assert.equal(loan.invoiceHash, up.body.invoiceHash);
  assert.equal(loan.borrower, env.wallet(A.meera).address);
  state.meeraLoan = ap.body.loanId;
});

test("INT-04 INV-02 is capped by the 5% member limit, with the reason shown", async () => {
  const up = await upload("kalpana", "INV-02");
  assert.equal(up.body.status, "verified");
  const total = await env.ctx.c.vault.totalAssets();
  const cap = Number((total * 500n) / 10000n / 10n ** 18n);
  assert.equal(up.body.principal, cap);
  assert.ok(up.body.principal < 720000);
  assert.match(up.body.checks.at(-1).detail, /limited by member/);
});

test("INT-05 INV-04 (same invoice, re-scanned) is refused by the backend and by the contract", async () => {
  const up = await upload("meera", "INV-04");
  assert.equal(up.body.status, "rejected");
  assert.match(up.body.reason, /financed before.*on-chain/);
  const due = (await env.provider.getBlock("latest")).timestamp + 30 * DAY;
  await assert.rejects(on(A.partner, "vault").openLoan(env.wallet(A.meera).address, r(1000), 1200, due, up.body.invoiceHash), /InvoiceAlreadyUsed|reverted/);
});

test("INT-06 INV-05, INV-06, INV-08 and INV-09 are each rejected with their own reason", async () => {
  const cases = [["ashok", "INV-05", /Amount matches GSTR-1: expected 180000, got 480000/], ["gopal", "INV-06", /Buyer GSTIN is registered and Active/],
    ["outsider", "INV-08", /Seller is a verified member/], ["pratima", "INV-09", /Seller GSTIN matches/]];
  for (const [who, inv, re] of cases) {
    const up = await upload(who, inv);
    assert.equal(up.body.status, "rejected", inv);
    assert.match(up.body.reason, re, inv);
  }
});

test("INT-11 INV-07's hidden instructions are flagged; approval needs a person's override and note", async () => {
  const up = await upload("lipika", "INV-07");
  assert.equal(up.body.status, "flagged");
  assert.ok(up.body.guard.hidden.length > 0);
  assert.ok(up.body.guard.rules.length > 0);
  assert.equal(up.body.guard.model.injection, true);
  assert.ok(up.body.checks.every((k) => k.ok), "the invoice data itself is genuine");
  state.inv07 = up.body.id;
  const no = await env.api("POST", `/partner/invoices/${up.body.id}/approve`, { token: T.partner, body: {} });
  assert.equal(no.status, 409);
  const yes = await env.api("POST", `/partner/invoices/${up.body.id}/approve`, { token: T.partner, body: { override: true, note: "Called the buyer; amounts match GSTR-1" } });
  assert.equal(yes.status, 200, JSON.stringify(yes.body));
  assert.equal((await env.ctx.c.vault.loans(yes.body.loanId)).principal, r(176000));
});

test("INT-07 the agent route needs its token; a hallucinated number is stored as rejected and never signable", async () => {
  assert.equal((await env.api("POST", "/proposals", { body: { proposal: {} } })).status, 401);
  ollama.state.mode = "hallucinate";
  const out = await runAgent();
  ollama.state.mode = "ok";
  assert.equal(out.status, 422);
  assert.equal(out.body.status, "rejected");
  assert.ok(out.body.validation.violations.some((v) => v.rule === "R4" && /cited 600, chain says 550/.test(v.msg)));
  const p = (await env.api("GET", `/proposals/${out.body.id}`)).body;
  assert.equal(p.signable, false);
  assert.equal(p.submit, null);
});

test("INT-12 the agent end to end: snapshot, model, validator, a signable proposal", async () => {
  const out = await runAgent();
  assert.equal(out.status, 201, JSON.stringify(out.body.validation?.violations));
  assert.equal(out.body.status, "ready");
  const p = (await env.api("GET", `/proposals/${out.body.id}`)).body;
  assert.equal(p.validation.passed.length, 11);
  assert.ok(p.validation.evidence.every((e) => e.match));
  assert.equal(p.submit.target, env.ctx.c.addresses.vault);
  assert.equal(p.meta.ollamaVersion, "fake-0.0.0");
  state.proposal = p;
});

test("INT-08 committee submits: the on-chain proposalHash is the SHA-256 of the stored file", async () => {
  const s = state.proposal.submit;
  const id = await env.ctx.c.multisig.nextProposalId();
  await (await on(A.prakash, "multisig").submit(s.target, 0, s.data, s.salt, s.proposalHash)).wait();
  await (await on(A.sasmita, "multisig").confirm(id)).wait();
  await reconcile(); // also indexes
  const p = (await env.api("GET", `/proposals/${state.proposal.id}`)).body;
  assert.equal(p.onChain.state, "scheduled");
  assert.equal(p.onChain.confirmations, 2);
  const v = (await env.api("GET", `/audit/verify/${s.proposalHash}`)).body;
  assert.equal(v.fileMatches, true);
  assert.equal(v.onChain.proposalId, Number(id));
  const doc = JSON.parse(fs.readFileSync(path.join(env.dataDir, "docs", `${s.proposalHash}.json`), "utf8"));
  const { proposalHashOf } = await import("../../src/lib/hash.js");
  assert.equal(proposalHashOf(doc.proposal, doc.snapshot), s.proposalHash);
});

test("INT-09 after 24 h the keeper executes and the split moves to about 10% G-secs", async () => {
  assert.equal((await keeper()).length, 0, "nothing is executable before the delay");
  await travel(DAY);
  const did = await keeper();
  assert.ok(did.some((d) => d.kind === "executed"), JSON.stringify(did));
  const pool = (await env.api("GET", "/pool")).body;
  assert.ok(pool.allocation.gsecBps >= 950 && pool.allocation.gsecBps <= 1050, JSON.stringify(pool.allocation));
  const p = (await env.api("GET", `/proposals/${state.proposal.id}`)).body;
  assert.equal(p.onChain.state, "executed");
  assert.equal((await reconcile()).ok, true);
});

test("INT-13 a forged 60% proposal fails the validator, and forced through the multisig it fails on-chain", async () => {
  const forged = (await env.api("POST", "/ops/forge-proposal")).body;
  assert.equal(forged.status, "rejected");
  const rules = forged.validation.violations.map((v) => v.rule);
  assert.ok(rules.includes("R7") && rules.includes("R8"), rules.join(","));
  const did = await govern(forged.forced.data, forged.forced.target, "forced");
  assert.ok(did.some((d) => d.kind === "execute_failed" && d.error === "GsecCapExceeded"), JSON.stringify(did));
  // Hygiene: a committee member cancels the failed operation so nothing can retry it later
  const failed = did.find((d) => d.kind === "execute_failed");
  await (await on(A.rakesh, "multisig").cancel(failed.proposalId)).wait();
  assert.ok(!(await keeper()).some((d) => d.proposalId === failed.proposalId));
});

test("INT-14 the exporter pays, Meera repays with interest, the share price rises, books still balance", async () => {
  const price0 = (await env.api("GET", "/pool")).body.sharePrice;
  await env.api("POST", "/ops/exporter-pays", { body: { memberId: "M01", amountInr: 250000 } });
  await travel(30 * DAY);
  const due = await env.ctx.c.vault.interestDue(state.meeraLoan);
  const owed = r(200000) + due + r(100); // a few seconds of extra interest
  await (await on(A.meera, "eInr").approve(env.ctx.c.addresses.gateway, owed)).wait();
  await (await on(A.meera, "gateway").cashIn(owed)).wait();
  await (await on(A.meera, "arc").approve(env.ctx.c.addresses.vault, owed)).wait();
  await (await on(A.meera, "vault").repayLoan(state.meeraLoan)).wait();
  const me = (await env.api("GET", "/me", { token: T.meera })).body;
  assert.equal(me.loans.find((l) => l.id === state.meeraLoan).status, "Repaid");
  assert.ok((await env.api("GET", "/pool")).body.sharePrice > price0);
  assert.equal((await reconcile()).ok, true, "coupons and interest are accounted for");
});

test("INT-15 a redemption bigger than the buffer queues, the keeper pulls G-secs T+1, Nirmal claims", async () => {
  const pre = await env.api("POST", "/ops/preset/tight");
  assert.equal(pre.status, 200, JSON.stringify(pre.body));
  const n = env.wallet(A.nirmal);
  const shares = await env.ctx.c.vault.balanceOf(n.address);
  assert.ok((await env.ctx.c.vault.maxRedeem(n.address)) < shares, "the buffer cannot pay him today");
  await (await on(A.nirmal, "vault").requestRedeem(shares)).wait();
  const reqId = (await env.ctx.c.vault.nextRedeemId()) - 1n;
  let did = await keeper();
  assert.ok(did.some((d) => d.kind === "requested_gsec"), JSON.stringify(did));
  await travel(DAY); // the coupon paid over this day raises the share price, so the queue grows slightly
  did = await keeper();
  assert.ok(did.some((d) => d.kind === "claimed_gsec"), JSON.stringify(did));
  did = await keeper();
  assert.ok(did.some((d) => d.kind === "fulfilled"), JSON.stringify(did));
  const q = await env.ctx.c.vault.redeemRequests(reqId);
  await (await on(A.nirmal, "vault").claimRedeem(reqId)).wait();
  assert.equal(await env.ctx.c.arc.balanceOf(n.address), q.assets);
  assert.ok(q.assets > r(1000000), "he gets his Rs 10 lakh plus his share of the gains");
  assert.equal((await reconcile()).ok, true);
});

test("REC-02 a lying RPC turns the reconciler red and pauses allocations; redemptions still work", async () => {
  await env.api("POST", "/ops/chaos", { body: { mode: "lie" } });
  const out = await reconcile();
  await env.api("POST", "/ops/chaos", { body: { mode: "off" } });
  assert.equal(out.ok, false);
  assert.equal(out.details.find((d) => d.name === "Both RPC paths agree").ok, false);
  assert.ok(out.pauseTx?.startsWith("0x"));
  const pool = (await env.api("GET", "/pool")).body;
  assert.equal(pool.paused, true);
  assert.equal(pool.reconciler.ok, false);
  const m = env.wallet(A.meera);
  await (await on(A.meera, "vault").redeem(r(1000), m.address, m.address)).wait(); // pause never traps money
});

test("REC-05 after the fix, only a committee proposal through the timelock unpauses", async () => {
  assert.equal((await reconcile()).ok, true, "chaos is off, the books agree again");
  for (const i of [A.rakesh, 28, A.partner]) await assert.rejects(on(i, "vault").unpause(), /AccessControl|reverted/);
  const did = await govern(env.ctx.c.interfaces.vault.encodeFunctionData("unpause", []), env.ctx.c.addresses.vault, "unpause-1");
  assert.ok(did.some((d) => d.kind === "executed"), JSON.stringify(did));
  assert.equal(await env.ctx.c.vault.paused(), false);
});

test("REC-03 a stale RPC is caught the same way", async () => {
  await env.api("POST", "/ops/chaos", { body: { mode: "stale" } });
  const out = await reconcile();
  await env.api("POST", "/ops/chaos", { body: { mode: "off" } });
  assert.equal(out.ok, false);
  assert.ok(out.pauseTx?.startsWith("0x"));
  await govern(env.ctx.c.interfaces.vault.encodeFunctionData("unpause", []), env.ctx.c.addresses.vault, "unpause-2");
  assert.equal(await env.ctx.c.vault.paused(), false);
});

test("REC-04 a deleted bank ledger row is caught and named; re-importing the statement fixes it", async () => {
  const db = env.ctx.db;
  const row = db.prepare("SELECT id FROM partner_bank_ledger ORDER BY id DESC LIMIT 1").get();
  db.prepare("DELETE FROM partner_bank_ledger WHERE id = ?").run(row.id);
  const out = await reconcile();
  assert.equal(out.ok, false);
  const bad = out.details.find((d) => !d.ok);
  assert.equal(bad.name, "eINR held by the gateway");
  assert.notEqual(bad.bank, bad.chain);
  db.prepare("UPDATE meta SET value = ? WHERE key = 'last_block'").run(String(env.ctx.c.deployment.deployBlock - 1));
  assert.equal((await reconcile()).ok, true);
  await govern(env.ctx.c.interfaces.vault.encodeFunctionData("unpause", []), env.ctx.c.addresses.vault, "unpause-3");
});

test("AI-12 if Ollama is down or answers garbage, no proposal is stored and nothing breaks", async () => {
  const count = () => env.ctx.db.prepare("SELECT COUNT(*) n FROM proposals").get().n;
  const n0 = count();
  for (const mode of ["down", "garbage"]) {
    ollama.state.mode = mode;
    await assert.rejects(runAgent(), /Ollama/);
  }
  ollama.state.mode = "ok";
  assert.equal(count(), n0);
  assert.equal((await env.api("GET", "/health")).body.ok, true);
});

test("INT-10 demo controls are refused on any chain other than the local one", async () => {
  env.ctx.isLocal = false;
  const res = await travel(60);
  env.ctx.isLocal = true;
  assert.equal(res.status, 403);
});

test("INT-16 Reset demo returns the chain and the database to the seeded state", async () => {
  const res = await env.api("POST", "/ops/reset");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const pool = (await env.api("GET", "/pool")).body;
  assert.equal(pool.tvl, 12000000);
  assert.deepEqual(pool.allocation, { bufferBps: 10000, gsecBps: 0, invoiceBps: 0 });
  assert.equal(env.ctx.db.prepare("SELECT COUNT(*) n FROM proposals").get().n, 0);
  assert.equal((await reconcile()).ok, true);
});
