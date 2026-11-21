import { Router } from "express";
import multer from "multer";
import { getAddress, id as keccakId } from "ethers";
import { requireRole } from "../api/auth.js";
import { processInvoice, getInvoice, approveInvoice } from "./invoices.js";
import { toRupeesExact } from "../lib/money.js";
import { events, indexOnce } from "../indexer.js";
import { resetSigners } from "../lib/signer.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

/** Runs fn once per key; later calls with the same key return the stored response (network retries). */
export async function once(db, key, fn) {
  const hit = db.prepare("SELECT response_json FROM idempotency_keys WHERE key = ?").get(key);
  if (hit) return { ...JSON.parse(hit.response_json), replayed: true };
  const out = await fn();
  db.prepare("INSERT OR IGNORE INTO idempotency_keys(key, created_at, response_json) VALUES (?,?,?)").run(key, new Date().toISOString(), JSON.stringify(out));
  return out;
}

// A failed send can leave the nonce manager one ahead; reset it so the next transaction is not stuck.
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => { if (!e.status) resetSigners(); res.status(e.status || 500).json({ error: e.shortMessage || e.reason || e.message }); });

export function partnerRouter(ctx) {
  const r = Router();
  const { db, c } = ctx;
  const partnerOnly = requireRole("partner");
  const DSTATUS = ["None", "Pending", "Settled", "Rejected", "Cancelled"];

  r.get("/partner/queue", partnerOnly, wrap(async (_req, res) => {
    await indexOnce(db, c, ctx.provider);
    const deposits = [];
    for (const e of events(db, { contract: "gateway", event: "DepositRequested", limit: 100000 })) {
      const d = await c.gateway.deposits(e.args.id);
      if (d.status === 1n) deposits.push({ id: Number(e.args.id), member: d.member, amount: toRupeesExact(d.amount), createdAt: Number(d.createdAt), txHash: e.tx_hash });
    }
    const invoices = db.prepare("SELECT id FROM invoices ORDER BY id DESC LIMIT 100").all().map(({ id }) => getInvoice(ctx, id));
    res.json({ deposits, invoices });
  }));

  r.post("/partner/deposits/:id/settle", partnerOnly, wrap(async (req, res) => {
    const id = BigInt(req.params.id);
    const out = await once(db, `settle:${c.addresses.gateway}:${id}`, async () => {
      const d = await c.gateway.deposits(id);
      if (d.status !== 1n) throw Object.assign(new Error(`deposit ${id} is ${DSTATUS[Number(d.status)]}`), { status: 409 });
      const rc = await (await c.gateway.connect(ctx.signer("partner")).settleDeposit(id)).wait();
      return { id: Number(id), status: "Settled", txHash: rc.hash, block: rc.blockNumber };
    });
    res.json(out);
  }));

  r.post("/partner/deposits/:id/reject", partnerOnly, wrap(async (req, res) => {
    const id = BigInt(req.params.id);
    const out = await once(db, `reject:${c.addresses.gateway}:${id}`, async () => {
      const d = await c.gateway.deposits(id);
      if (d.status !== 1n) throw Object.assign(new Error(`deposit ${id} is ${DSTATUS[Number(d.status)]}`), { status: 409 });
      const rc = await (await c.gateway.connect(ctx.signer("partner")).rejectDeposit(id)).wait();
      return { id: Number(id), status: "Rejected", txHash: rc.hash, block: rc.blockNumber };
    });
    res.json(out);
  }));

  /** A fresh idempotency key for PartnerGateway.requestDeposit, so a retried click cannot deposit twice. */
  r.post("/deposits/intent", requireRole("verified"), (req, res) => {
    const clientKey = keccakId(`${req.user.address}:${Date.now()}:${Math.random()}`);
    res.json({ clientKey, gateway: c.addresses.gateway, eInr: c.addresses.eInr, steps: ["eInr.approve(gateway, amount)", "gateway.requestDeposit(amount, clientKey)"] });
  });

  r.post("/partner/kyc", partnerOnly, wrap(async (req, res) => {
    const address = getAddress(req.body.address);
    const rc = await (await c.kyc.connect(ctx.signer("partner")).setVerified(address, Boolean(req.body.verified))).wait();
    res.json({ address, verified: Boolean(req.body.verified), txHash: rc.hash });
  }));

  r.post("/invoices", requireRole(), upload.single("file"), wrap(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "attach the invoice PDF as 'file'" });
    const inv = await processInvoice(ctx, { buffer: req.file.buffer, uploader: req.user.address, originalName: req.file.originalname });
    res.status(201).json(inv);
  }));

  r.get("/invoices", requireRole(), (req, res) => {
    const rows = req.user.roles.partner ? db.prepare("SELECT id FROM invoices ORDER BY id DESC").all() : db.prepare("SELECT id FROM invoices WHERE member_address = ? ORDER BY id DESC").all(req.user.address);
    res.json({ invoices: rows.map(({ id }) => getInvoice(ctx, id)) });
  });

  r.get("/invoices/:id", requireRole(), (req, res) => {
    const inv = getInvoice(ctx, Number(req.params.id));
    if (!inv || (!req.user.roles.partner && inv.member !== req.user.address)) return res.status(404).json({ error: "not found" });
    res.json(inv);
  });

  r.post("/partner/invoices/:id/approve", partnerOnly, wrap(async (req, res) => {
    const id = Number(req.params.id);
    const out = await once(db, `approve:${id}`, () => approveInvoice(ctx, id, req.body || {}));
    res.json(out);
  }));

  r.post("/partner/invoices/:id/reject", partnerOnly, wrap(async (req, res) => {
    const inv = getInvoice(ctx, Number(req.params.id));
    if (!inv) return res.status(404).json({ error: "not found" });
    if (inv.status === "approved") return res.status(409).json({ error: "already approved" });
    db.prepare("UPDATE invoices SET status = 'rejected', reason = ? WHERE id = ?").run(`rejected by partner: ${req.body?.reason || "no reason given"}`, inv.id);
    res.json(getInvoice(ctx, inv.id));
  }));

  r.post("/partner/loans/:id/write-off", partnerOnly, wrap(async (req, res) => {
    const rc = await (await c.vault.connect(ctx.signer("partner")).writeOffLoan(BigInt(req.params.id))).wait();
    res.json({ loanId: Number(req.params.id), txHash: rc.hash });
  }));
  return r;
}
