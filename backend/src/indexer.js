// Indexes every contract event into ledger_events, and the eINR moving in/out of the gateway into
// partner_bank_ledger (the partner's own "bank statement"). Keyed by (txHash, logIndex): replay-safe.
import { zeroPadValue } from "ethers";
import { meta, tx, wipe } from "./lib/db.js";

const INDEXED = ["vault", "gateway", "multisig", "timelock", "gsec", "kyc"];
const jsonArgs = (frag, args) => Object.fromEntries(frag.inputs.map((inp, i) => [inp.name || `arg${i}`, typeof args[i] === "bigint" ? args[i].toString() : args[i]]));

export async function indexOnce(db, c, provider) {
  const head = await provider.getBlockNumber();
  // A restarted chain or a new deployment invalidates everything indexed so far
  if (meta.get(db, "deployment_vault") !== c.addresses.vault || Number(meta.get(db, "last_block") ?? -1) > head) {
    wipe(db);
    meta.set(db, "deployment_vault", c.addresses.vault);
    meta.set(db, "last_block", (c.deployment.deployBlock ?? 1) - 1);
  }
  const from = Number(meta.get(db, "last_block")) + 1;
  if (from > head) return 0;
  const to = Math.min(head, from + 2000);

  const byAddr = Object.fromEntries(INDEXED.map((k) => [c.addresses[k].toLowerCase(), k]));
  const logs = await provider.getLogs({ address: INDEXED.map((k) => c.addresses[k]), fromBlock: from, toBlock: to });
  const gw = zeroPadValue(c.addresses.gateway, 32);
  const transferTopic = c.interfaces.eInr.getEvent("Transfer").topicHash;
  const [inLogs, outLogs] = await Promise.all([
    provider.getLogs({ address: c.addresses.eInr, topics: [transferTopic, null, gw], fromBlock: from, toBlock: to }),
    provider.getLogs({ address: c.addresses.eInr, topics: [transferTopic, gw], fromBlock: from, toBlock: to }),
  ]);

  const ts = new Map();
  const tsOf = async (b) => { if (!ts.has(b)) ts.set(b, (await provider.getBlock(b)).timestamp); return ts.get(b); };
  const rows = [];
  for (const log of logs) {
    const name = byAddr[log.address.toLowerCase()];
    let parsed;
    try { parsed = c.interfaces[name].parseLog(log); } catch { continue; }
    if (!parsed) continue;
    rows.push([log.blockNumber, log.transactionHash, log.index, name, parsed.name, JSON.stringify(jsonArgs(parsed.fragment, parsed.args)), await tsOf(log.blockNumber)]);
  }
  const bank = [];
  for (const [dir, list] of [["in", inLogs], ["out", outLogs]]) {
    for (const log of list) {
      const p = c.interfaces.eInr.parseLog(log);
      bank.push([log.blockNumber, log.transactionHash, log.index, dir, dir === "in" ? p.args.from : p.args.to, p.args.value.toString()]);
    }
  }
  tx(db, () => {
    const ins = db.prepare("INSERT OR IGNORE INTO ledger_events(block, tx_hash, log_index, contract, event, args, ts) VALUES (?,?,?,?,?,?,?)");
    for (const r of rows) ins.run(...r);
    const bins = db.prepare("INSERT OR IGNORE INTO partner_bank_ledger(block, tx_hash, log_index, direction, counterparty, amount_wei) VALUES (?,?,?,?,?,?)");
    for (const b of bank) bins.run(...b);
    meta.set(db, "last_block", to);
  });
  return rows.length;
}

export function events(db, { contract, event, sinceId = 0, limit = 1000 } = {}) {
  let sql = "SELECT * FROM ledger_events WHERE id > ?";
  const args = [sinceId];
  if (contract) { sql += " AND contract = ?"; args.push(contract); }
  if (event) { sql += " AND event = ?"; args.push(event); }
  sql += " ORDER BY block, log_index LIMIT ?";
  args.push(limit);
  return db.prepare(sql).all(...args).map((r) => ({ ...r, args: JSON.parse(r.args) }));
}

export function startIndexer(db, c, provider, intervalMs, log = console) {
  let busy = false;
  const tick = async () => {
    if (busy) return; busy = true;
    try { await indexOnce(db, c, provider); } catch (e) { log.error("[indexer]", e.shortMessage || e.message); } finally { busy = false; }
  };
  tick();
  return setInterval(tick, intervalMs);
}
