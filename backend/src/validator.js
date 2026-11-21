// Layer 2: a pure function. No AI, no I/O. The snapshot passed in is the BACKEND's own,
// rebuilt from the chain at the block the agent names; the agent's numbers are never trusted.
import { CITABLE, snapshotHash } from "./snapshot.js";

export const ACTIONS = ["ALLOCATE_TO_GSEC", "REQUEST_FROM_GSEC", "NO_ACTION"];
const SPLIT_KEYS = ["bufferBps", "gsecBps", "invoiceBps"];
const TOP_KEYS = ["blockNumber", "snapshotHash", "action", "current", "target", "dataPoints", "confidence", "rationale", "wouldChangeIf"];

export const RULES = {
  R1: "Schema", R2: "Fresh data", R3: "Same data", R4: "Every number is real", R5: "Current state",
  R6: "Sums and direction", R7: "Policy caps", R8: "Move size", R9: "Redemption cover", R10: "Confidence", R11: "Clean rationale",
};

const isInt = (x) => Number.isInteger(x);
const isSplit = (o) => o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).length === 3 && SPLIT_KEYS.every((k) => isInt(o[k]) && o[k] >= 0 && o[k] <= 10000);

function schema(p) {
  const v = [];
  if (!p || typeof p !== "object" || Array.isArray(p)) return ["proposal is not an object"];
  const extra = Object.keys(p).filter((k) => !TOP_KEYS.includes(k));
  if (extra.length) v.push(`unexpected fields: ${extra.join(", ")}`);
  for (const k of TOP_KEYS) if (!(k in p)) v.push(`missing field: ${k}`);
  if ("blockNumber" in p && !(isInt(p.blockNumber) && p.blockNumber >= 0)) v.push("blockNumber must be a non-negative integer");
  if ("snapshotHash" in p && !/^0x[0-9a-f]{64}$/.test(p.snapshotHash)) v.push("snapshotHash must be 0x + 64 hex");
  if ("action" in p && !ACTIONS.includes(p.action)) v.push(`action must be one of ${ACTIONS.join(", ")}`);
  if ("current" in p && !isSplit(p.current)) v.push("current must be {bufferBps, gsecBps, invoiceBps} integers 0..10000");
  if ("target" in p && !isSplit(p.target)) v.push("target must be {bufferBps, gsecBps, invoiceBps} integers 0..10000");
  if ("dataPoints" in p && !(Array.isArray(p.dataPoints) && p.dataPoints.every((d) => d && typeof d.name === "string" && typeof d.value === "number" && Object.keys(d).length === 2)))
    v.push("dataPoints must be [{name, value}] with numeric values");
  if ("confidence" in p && !["low", "medium", "high"].includes(p.confidence)) v.push("confidence must be low, medium or high");
  if ("rationale" in p && typeof p.rationale !== "string") v.push("rationale must be a string");
  if ("wouldChangeIf" in p && typeof p.wouldChangeIf !== "string") v.push("wouldChangeIf must be a string");
  return v;
}

/** Percentages and rupee amounts written in the rationale, Indian number formats included. */
export function numbersInText(text) {
  const out = [];
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s?(%|per ?cent)/gi)) out.push({ kind: "pct", value: Number(m[1]), raw: m[0] });
  for (const m of text.matchAll(/(?:Rs\.?|₹|INR)\s?([\d,]+(?:\.\d+)?)(?:\s*(crore|cr\b|lakhs?|lacs?))?/gi)) {
    let n = Number(m[1].replace(/,/g, ""));
    const unit = (m[2] || "").toLowerCase();
    if (unit.startsWith("cr")) n *= 1e7;
    else if (unit.startsWith("la")) n *= 1e5;
    out.push({ kind: "rs", value: n, raw: m[0].trim() });
  }
  return out;
}

function derived(p, s) {
  const tvl = s.tvl;
  const pol = s.policy;
  const pct = new Set([15, 50, 35, 5, pol.bufferMinBps / 100, pol.maxMoveBps / 100, pol.minTbillBps / 100]);
  const rs = new Set([tvl]);
  for (const d of p.dataPoints) {
    if (d.name.endsWith("Bps")) pct.add(d.value / 100);
    if (d.name.endsWith("Arc")) rs.add(d.value);
  }
  for (const split of [p.current, p.target]) for (const k of SPLIT_KEYS) { pct.add(split[k] / 100); rs.add(Math.round((split[k] * tvl) / 10000)); }
  const move = Math.abs(p.target.gsecBps - p.current.gsecBps);
  pct.add(move / 100);
  rs.add(Math.round((move * tvl) / 10000));
  rs.add(Math.round(pol.redemptionCover * (s.redemptions.expected7d + s.redemptions.pendingAssets)));
  return { pct: [...pct], rs: [...rs] };
}

const near = (a, b, rel, abs) => Math.abs(a - b) <= Math.max(abs, Math.abs(b) * rel);

/**
 * @param proposal  what the agent sent
 * @param snapshot  the backend's own snapshot at proposal.blockNumber
 * @param ctx       { currentBlock, now } (seconds), passed in to keep this function pure
 */
export function validate(proposal, snapshot, ctx) {
  const violations = [];
  const add = (rule, msg) => violations.push({ rule, name: RULES[rule], msg });
  const pol = snapshot.policy;

  const schemaErrors = schema(proposal);
  if (schemaErrors.length) {
    schemaErrors.forEach((m) => add("R1", m));
    return { ok: false, signable: false, violations, passed: [] };
  }
  const p = proposal;

  // R2 fresh
  if (ctx.currentBlock - p.blockNumber > pol.maxSnapshotAgeBlocks) add("R2", `snapshot is ${ctx.currentBlock - p.blockNumber} blocks old (max ${pol.maxSnapshotAgeBlocks})`);
  if (ctx.now - snapshot.blockTimestamp > pol.maxSnapshotAgeSec) add("R2", `snapshot is ${ctx.now - snapshot.blockTimestamp} s old (max ${pol.maxSnapshotAgeSec})`);

  // R3 same data
  const expectHash = snapshotHash(snapshot);
  if (p.snapshotHash !== expectHash) add("R3", `snapshotHash ${p.snapshotHash.slice(0, 10)}... does not match the backend's ${expectHash.slice(0, 10)}...`);

  // R4 every number is real
  const evidence = [];
  for (const dp of p.dataPoints) {
    const read = CITABLE[dp.name];
    if (!read) { add("R4", `unknown field ${dp.name}`); evidence.push({ ...dp, chain: null, match: false }); continue; }
    const actual = read(snapshot);
    const tol = dp.name.endsWith("Bps") ? 1 : 0;
    const match = Math.abs(dp.value - actual) <= tol;
    evidence.push({ name: dp.name, cited: dp.value, chain: actual, match });
    if (!match) add("R4", `${dp.name}: cited ${dp.value}, chain says ${actual}`);
  }
  if (p.dataPoints.length < pol.minDataPoints) add("R4", `cite at least ${pol.minDataPoints} data points (got ${p.dataPoints.length})`);
  const allowed = derived(p, snapshot);
  // wouldChangeIf states a hypothetical trigger, not a fact, so only the rationale is checked here
  for (const n of numbersInText(p.rationale)) {
    const ok = n.kind === "pct" ? allowed.pct.some((a) => near(n.value, a, 0, 0.01)) : allowed.rs.some((a) => near(n.value, a, 0.005, 1));
    if (!ok) add("R4", `rationale mentions "${n.raw}", which matches no cited or derived figure`);
  }

  // R5 current state
  for (const k of SPLIT_KEYS) if (p.current[k] !== snapshot.allocation[k]) add("R5", `current.${k} is ${p.current[k]}, chain says ${snapshot.allocation[k]}`);

  // R6 sums and direction
  const sum = p.target.bufferBps + p.target.gsecBps + p.target.invoiceBps;
  if (sum !== 10000) add("R6", `target adds up to ${sum} bps, not 10000`);
  const dG = p.target.gsecBps - p.current.gsecBps;
  if (p.action === "ALLOCATE_TO_GSEC" && !(dG > 0)) add("R6", "ALLOCATE_TO_GSEC needs a higher G-sec target");
  if (p.action === "REQUEST_FROM_GSEC" && !(dG < 0)) add("R6", "REQUEST_FROM_GSEC needs a lower G-sec target");
  if (p.action === "NO_ACTION" && SPLIT_KEYS.some((k) => p.target[k] !== p.current[k])) add("R6", "NO_ACTION must keep target equal to current");

  // R7 policy caps
  if (p.target.invoiceBps !== p.current.invoiceBps) add("R7", "the agent may not change the invoice pool share; loans are the partner's decision");
  if (p.action === "ALLOCATE_TO_GSEC") {
    if (p.target.bufferBps < pol.bufferMinBps) add("R7", `target buffer ${p.target.bufferBps / 100}% is below the policy minimum ${pol.bufferMinBps / 100}%`);
    if (p.target.gsecBps > pol.gsecMaxBps) add("R7", `target G-sec ${p.target.gsecBps / 100}% is above the cap ${pol.gsecMaxBps / 100}%`);
    if (snapshot.gsec.aprBps < pol.minTbillBps) add("R7", `T-bill APR ${snapshot.gsec.aprBps} bps is below the policy floor ${pol.minTbillBps} bps`);
  }

  // R8 move size
  if (Math.abs(dG) > pol.maxMoveBps) add("R8", `move of ${Math.abs(dG) / 100}% exceeds the daily limit of ${pol.maxMoveBps / 100}%`);

  // R9 redemption cover
  const amountRupees = Math.floor((Math.abs(dG) * snapshot.tvl) / 10000);
  if (p.action === "ALLOCATE_TO_GSEC") {
    const bufferAfter = snapshot.amounts.buffer - amountRupees;
    const need = Math.ceil(pol.redemptionCover * (snapshot.redemptions.expected7d + snapshot.redemptions.pendingAssets));
    if (bufferAfter < need) add("R9", `buffer after the move Rs ${bufferAfter} is below ${pol.redemptionCover} x expected redemptions (Rs ${need})`);
  }
  if (p.action === "REQUEST_FROM_GSEC" && amountRupees > snapshot.amounts.gsec) add("R9", "cannot request more than the G-sec value");

  // R11 clean rationale
  const text = `${p.rationale}\n${p.wouldChangeIf}`;
  const words = p.rationale.trim().split(/\s+/).filter(Boolean).length;
  if (words > pol.maxRationaleWords) add("R11", `rationale is ${words} words (max ${pol.maxRationaleWords})`);
  if (/https?:\/\/|www\./i.test(text)) add("R11", "rationale contains a URL");
  if (/0x[0-9a-f]{6,}/i.test(text)) add("R11", "rationale contains an address or hash");
  if (/```|<\/?[a-z]+>|\{\s*"/i.test(text)) add("R11", "rationale contains code or markup");
  if (/ignore (all |any )?(previous|prior|above)|system prompt|disregard|you must|as an ai/i.test(text)) add("R11", "rationale contains instruction-like text");

  const ok = violations.length === 0;
  // R10 confidence: low is never signable, even when every other rule passes
  const lowConfidence = p.confidence === "low";
  const signable = ok && !lowConfidence && p.action !== "NO_ACTION";
  const passed = Object.keys(RULES).filter((r) => !violations.some((v) => v.rule === r) && !(r === "R10" && lowConfidence));
  return {
    ok, signable, violations, passed, evidence,
    notes: lowConfidence ? ["R10: low confidence is stored as no action"] : [],
    call: signable ? { fn: p.action === "ALLOCATE_TO_GSEC" ? "allocateToGsec" : "requestFromGsec", amountRupees } : null,
  };
}
