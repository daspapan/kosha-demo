import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { getAddress } from "ethers";
import { buildSnapshot } from "../snapshot.js";
import { registry } from "../lib/registry.js";
import { toRupeesExact } from "../lib/money.js";
import { proposalHashOf } from "../lib/hash.js";
import { loadAbis } from "../lib/chain.js";
import { requireRole } from "./auth.js";
import { events, indexOnce } from "../indexer.js";

export function readRouter(ctx) {
  const r = Router();
  const { db, c, provider } = ctx;

  r.get("/health", async (_req, res) => {
    const block = await provider.getBlockNumber().catch(() => null);
    res.json({ ok: block !== null, block, chainId: ctx.chainId, network: ctx.config.network });
  });

  r.get("/config", (_req, res) => {
    const abis = loadAbis();
    res.json({ chainId: ctx.chainId, addresses: c.addresses, deployBlock: c.deployment.deployBlock, abis, demo: ctx.isLocal });
  });

  r.get("/registry", (_req, res) => {
    const { members, exporters } = registry();
    res.json({ members: members.map(({ member_id, name, business, location, sector, address, kyc }) => ({ member_id, name, business, location, sector, address, kyc })), exporters });
  });

  r.get("/pool", async (_req, res) => {
    const s = await buildSnapshot(c, provider);
    const last = db.prepare("SELECT at, block, ok, details_json FROM reconciler_runs ORDER BY id DESC LIMIT 1").get();
    const latest = db.prepare("SELECT id, created_at, status, action, proposal_hash FROM proposals WHERE source = 'agent' ORDER BY id DESC LIMIT 1").get();
    res.json({
      block: s.blockNumber, timestamp: s.blockTimestamp, tvl: s.tvl, sharePrice: s.sharePriceMicroRupees / 1e6, allocation: s.allocation, amounts: s.amounts,
      caps: { bufferMinBps: 1500, gsecMaxBps: 5000, invoiceMaxBps: 3500, memberMaxBps: 500, policyBufferMinBps: s.policy.bufferMinBps },
      tbillAprBps: s.gsec.aprBps, redemptions: s.redemptions, loans: s.loans, reserve: s.reserve, paused: s.paused,
      reconciler: last ? { ...last, ok: Boolean(last.ok), details: JSON.parse(last.details_json), details_json: undefined } : null,
      latestProposal: latest ?? null,
    });
  });

  r.get("/me", requireRole(), async (req, res) => {
    await indexOnce(db, c, provider);
    const a = req.user.address;
    const [shares, eInr, arc, maxRedeem] = await Promise.all([c.vault.balanceOf(a), c.eInr.balanceOf(a), c.arc.balanceOf(a), c.vault.maxRedeem(a)]);
    const value = await c.vault.convertToAssets(shares);
    const mine = (e) => JSON.stringify(e.args).toLowerCase().includes(a.toLowerCase());
    const all = events(db, { limit: 100000 });
    const deposits = [];
    for (const e of all.filter((e) => e.contract === "gateway" && e.event === "DepositRequested" && e.args.member === a)) {
      const d = await c.gateway.deposits(e.args.id);
      deposits.push({ id: Number(e.args.id), amount: toRupeesExact(d.amount), status: ["None", "Pending", "Settled", "Rejected", "Cancelled"][Number(d.status)], txHash: e.tx_hash, createdAt: Number(d.createdAt) });
    }
    const loans = [];
    const next = await c.vault.nextLoanId();
    for (let id = 1n; id < next; id++) {
      const l = await c.vault.loans(id);
      if (l.borrower !== a) continue;
      loans.push({ id: Number(id), principal: toRupeesExact(l.principal), rateBps: Number(l.rateBps), openedAt: Number(l.openedAt), dueDate: Number(l.dueDate),
        status: ["None", "Active", "Repaid", "WrittenOff"][Number(l.status)], interestDue: toRupeesExact(await c.vault.interestDue(id)), invoiceHash: l.invoiceHash });
    }
    const redeems = [];
    for (const e of all.filter((e) => e.contract === "vault" && e.event === "RedeemRequested" && e.args.owner === a)) {
      const q = await c.vault.redeemRequests(e.args.id);
      redeems.push({ id: Number(e.args.id), shares: q.shares.toString(), assets: toRupeesExact(q.assets), status: ["None", "Pending", "Claimable", "Claimed", "Cancelled"][Number(q.status)], txHash: e.tx_hash });
    }
    res.json({
      address: a, roles: req.user.roles, member: registry().byAddress.get(a.toLowerCase()) ?? null,
      shares: shares.toString(), value: toRupeesExact(value), eInr: toRupeesExact(eInr), arc: toRupeesExact(arc), maxRedeemShares: maxRedeem.toString(),
      deposits, loans, redeems,
      statement: all.filter(mine).slice(-200).reverse().map((e) => ({ block: e.block, ts: e.ts, contract: e.contract, event: e.event, args: e.args, txHash: e.tx_hash })),
    });
  });

  r.get("/audit/events", async (req, res) => {
    await indexOnce(db, c, provider);
    const limit = Math.min(Number(req.query.limit || 200), 2000);
    const rows = db.prepare("SELECT * FROM ledger_events ORDER BY id DESC LIMIT ?").all(limit).map((e) => ({ ...e, args: JSON.parse(e.args) }));
    res.json({ events: rows });
  });

  r.get("/audit/reconciler", (_req, res) => {
    res.json({ runs: db.prepare("SELECT * FROM reconciler_runs ORDER BY id DESC LIMIT 50").all().map((x) => ({ ...x, ok: Boolean(x.ok), details: JSON.parse(x.details_json), details_json: undefined })) });
  });

  r.get("/audit/docs/:hash", (req, res) => {
    if (!/^0x[0-9a-f]{64}$/.test(req.params.hash)) return res.status(400).json({ error: "bad hash" });
    const file = path.join(ctx.docsDir, `${req.params.hash}.json`);
    if (!fs.existsSync(file)) return res.status(404).json({ error: "not found" });
    res.type("application/json").send(fs.readFileSync(file));
  });

  /** Recomputes the hash of a stored proposal file and looks for it on-chain. */
  r.get("/audit/verify/:hash", async (req, res) => {
    await indexOnce(db, c, provider);
    const h = req.params.hash;
    const file = path.join(ctx.docsDir, `${h}.json`);
    if (!/^0x[0-9a-f]{64}$/.test(h) || !fs.existsSync(file)) return res.status(404).json({ error: "no stored file for that hash" });
    const doc = JSON.parse(fs.readFileSync(file, "utf8"));
    const recomputed = proposalHashOf(doc.proposal, doc.snapshot);
    const sub = events(db, { contract: "multisig", event: "Submitted", limit: 100000 }).find((e) => e.args.proposalHash === h);
    res.json({ hash: h, recomputed, fileMatches: recomputed === h, onChain: sub ? { proposalId: Number(sub.args.id), txHash: sub.tx_hash, block: sub.block } : null });
  });

  r.get("/address/:a/roles", async (req, res) => {
    let a; try { a = getAddress(req.params.a); } catch { return res.status(400).json({ error: "bad address" }); }
    res.json(await (await import("./auth.js")).rolesOf(c, a));
  });
  return r;
}
