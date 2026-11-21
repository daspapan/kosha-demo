import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { buildSnapshot } from "../snapshot.js";
import { validate, RULES } from "../validator.js";
import { proposalHashOf } from "../lib/hash.js";
import { snapshotHash } from "../snapshot.js";
import { rupees } from "../lib/money.js";
import { requireAgent } from "./auth.js";
import { events, indexOnce } from "../indexer.js";

/** Runs the validator against the backend's OWN snapshot and stores the result. Used by the agent route and the demo forge. */
export async function acceptProposal(ctx, proposal, meta = {}, source = "agent") {
  const { db, c, provider } = ctx;
  const head = await provider.getBlock("latest");
  const wanted = Number.isInteger(proposal?.blockNumber) ? proposal.blockNumber : head.number;
  const deployBlock = c.deployment.deployBlock ?? 0;
  const at = wanted >= deployBlock && wanted <= head.number ? wanted : head.number;
  const snapshot = await buildSnapshot(c, provider, at);
  const result = validate(proposal, snapshot, { currentBlock: head.number, now: head.timestamp });
  if (wanted !== at) result.violations.unshift({ rule: "R2", name: RULES.R2, msg: `block ${wanted} is outside the chain (${deployBlock}..${head.number})` });
  if (wanted !== at) { result.ok = false; result.signable = false; result.call = null; }

  const status = !result.ok ? "rejected" : result.signable ? "ready" : "no_action";
  const proposalHash = proposalHashOf(proposal ?? null, snapshot);
  let target = null, calldata = null, amountWei = null;
  if (result.call) {
    target = c.addresses.vault;
    amountWei = rupees(result.call.amountRupees);
    calldata = c.interfaces.vault.encodeFunctionData(result.call.fn, [amountWei]);
  }
  fs.mkdirSync(ctx.docsDir, { recursive: true });
  fs.writeFileSync(path.join(ctx.docsDir, `${proposalHash}.json`), JSON.stringify({ proposal, snapshot, validation: result, meta, source }, null, 2));
  const existing = db.prepare("SELECT id FROM proposals WHERE proposal_hash = ?").get(proposalHash);
  if (existing) return { id: existing.id, duplicate: true, ...getProposal(ctx, existing.id) };
  const info = db.prepare(`INSERT INTO proposals(created_at, block_number, proposal_json, snapshot_json, proposal_hash, snapshot_hash, status, signable, violations_json,
      action, amount_wei, target, calldata, salt, model, meta_json, source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    new Date().toISOString(), at, JSON.stringify(proposal ?? null), JSON.stringify(snapshot), proposalHash, snapshotHash(snapshot), status, result.signable ? 1 : 0,
    JSON.stringify(result), proposal?.action ?? null, amountWei?.toString() ?? null, target, calldata, result.signable ? proposalHash : null, meta.model ?? null, JSON.stringify(meta), source);
  return { id: Number(info.lastInsertRowid), status, proposalHash, validation: result };
}

export function getProposal(ctx, id) {
  const row = ctx.db.prepare("SELECT * FROM proposals WHERE id = ?").get(id);
  if (!row) return null;
  return {
    id: row.id, createdAt: row.created_at, blockNumber: row.block_number, status: row.status, signable: Boolean(row.signable), source: row.source,
    proposal: JSON.parse(row.proposal_json), snapshot: JSON.parse(row.snapshot_json), validation: JSON.parse(row.violations_json),
    proposalHash: row.proposal_hash, snapshotHash: row.snapshot_hash, model: row.model, meta: JSON.parse(row.meta_json || "{}"),
    submit: row.signable ? { target: row.target, value: "0", data: row.calldata, salt: row.salt, proposalHash: row.proposal_hash, amountWei: row.amount_wei } : null,
  };
}

/** On-chain life of a proposal: submitted, confirmations, scheduled, executable at, executed, cancelled. */
export async function onChainStatus(ctx, proposalHash) {
  const sub = events(ctx.db, { contract: "multisig", event: "Submitted", limit: 100000 }).find((e) => e.args.proposalHash === proposalHash);
  if (!sub) return { state: "not_submitted" };
  const id = BigInt(sub.args.id);
  const p = await ctx.c.multisig.getProposal(id);
  const confirmations = events(ctx.db, { contract: "multisig", limit: 100000 }).filter((e) => ["Confirmed", "Revoked"].includes(e.event) && e.args.id === sub.args.id);
  const out = { proposalId: Number(id), submittedTx: sub.tx_hash, confirmations: Number(p.confirmations), confirmedBy: [], cancelled: p.cancelled, scheduled: p.scheduled };
  const votes = new Map();
  for (const e of confirmations) votes.set(e.args.by, e.event === "Confirmed");
  out.confirmedBy = [...votes].filter(([, v]) => v).map(([a]) => a);
  const cancel = events(ctx.db, { contract: "multisig", event: "Cancelled", limit: 100000 }).find((e) => e.args.id === sub.args.id);
  if (cancel) out.cancelledBy = cancel.args.by;
  if (p.scheduled) {
    const op = await ctx.c.multisig.operationId(id);
    const [ts, done] = await Promise.all([ctx.c.timelock.getTimestamp(op), ctx.c.timelock.isOperationDone(op)]);
    Object.assign(out, { operationId: op, readyAt: Number(ts), executed: done });
  }
  out.state = out.cancelled ? "cancelled" : out.executed ? "executed" : out.scheduled ? "scheduled" : "awaiting_signatures";
  return out;
}

export function proposalsRouter(ctx) {
  const r = Router();
  const agentOnly = requireAgent(ctx);

  r.post("/proposals", agentOnly, async (req, res) => {
    const out = await acceptProposal(ctx, req.body?.proposal, req.body?.meta ?? {}, "agent");
    res.status(out.status === "rejected" ? 422 : 201).json(out);
  });

  r.get("/proposals", async (_req, res) => {
    await indexOnce(ctx.db, ctx.c, ctx.provider);
    const rows = ctx.db.prepare("SELECT id FROM proposals ORDER BY id DESC LIMIT 50").all();
    const list = [];
    for (const { id } of rows) {
      const p = getProposal(ctx, id);
      list.push({ id, createdAt: p.createdAt, status: p.status, source: p.source, action: p.proposal?.action, confidence: p.proposal?.confidence,
        rationale: p.proposal?.rationale, proposalHash: p.proposalHash, failed: p.validation.violations.map((v) => v.rule), onChain: p.signable ? await onChainStatus(ctx, p.proposalHash) : null });
    }
    res.json({ proposals: list });
  });

  r.get("/proposals/:id", async (req, res) => {
    await indexOnce(ctx.db, ctx.c, ctx.provider);
    const p = getProposal(ctx, Number(req.params.id));
    if (!p) return res.status(404).json({ error: "not found" });
    res.json({ ...p, rules: RULES, onChain: p.signable ? await onChainStatus(ctx, p.proposalHash) : null });
  });

  // ---- agent work queue (the agent never touches the database itself)
  r.get("/agent/next", agentOnly, (_req, res) => {
    const job = ctx.db.prepare("SELECT * FROM agent_requests WHERE status = 'queued' ORDER BY id LIMIT 1").get();
    if (!job) return res.status(204).end();
    ctx.db.prepare("UPDATE agent_requests SET status = 'running' WHERE id = ?").run(job.id);
    res.json({ id: job.id, kind: job.kind, payload: JSON.parse(job.payload_json || "{}") });
  });
  r.post("/agent/requests/:id/done", agentOnly, (req, res) => {
    ctx.db.prepare("UPDATE agent_requests SET status = ? WHERE id = ?").run(req.body?.ok ? "done" : `failed: ${String(req.body?.error || "").slice(0, 200)}`, Number(req.params.id));
    ctx.agentLastSeen = Date.now();
    res.json({ ok: true });
  });
  r.get("/agent/context", agentOnly, (_req, res) => {
    ctx.agentLastSeen = Date.now();
    const rows = ctx.db.prepare("SELECT created_at, status, action, proposal_json FROM proposals WHERE source = 'agent' ORDER BY id DESC LIMIT 10").all();
    res.json({ history: rows.map((x) => ({ at: x.created_at, status: x.status, action: x.action, target: JSON.parse(x.proposal_json)?.target ?? null })) });
  });
  r.get("/agent/invoice-text/:id", agentOnly, (req, res) => {
    const inv = ctx.db.prepare("SELECT text FROM invoices WHERE id = ?").get(Number(req.params.id));
    if (!inv) return res.status(404).json({ error: "not found" });
    res.json({ text: inv.text });
  });
  return r;
}
