// The AI agent. A separate process with NO private key: it reads the chain, asks Ollama, and posts a
// proposal to the backend, which validates it. It cannot sign, schedule or execute anything.
import { pathToFileURL } from "node:url";
import { config } from "../lib/config.js";
import { makeProvider, contractsFor, loadDeployment } from "../lib/chain.js";
import { buildSnapshot, snapshotHash } from "../snapshot.js";
import { chatJson, ollamaVersion } from "../lib/ollama.js";
import { hashOf } from "../lib/hash.js";
import { buildPrompt, PROPOSAL_SCHEMA } from "./prompt.js";

/** AI-01: refuse to start if anything that looks like a key reached this process. */
export function assertNoKeys(env = process.env) {
  const bad = Object.entries(env).filter(([k, v]) => /PRIVATE_KEY|MNEMONIC|SEED_PHRASE|KMS_KEY/i.test(k) || /^(0x)?[0-9a-fA-F]{64}$/.test(String(v).trim())
    || /^(\w+ ){11,23}\w+$/.test(String(v).trim()));
  if (bad.length) throw new Error(`agent refuses to run: key-like environment variables present (${bad.map(([k]) => k).join(", ")})`);
}

export async function runOnce({ provider, c, backendUrl = config.backendUrl, token = config.agentToken, ollama = {}, payload = {} }) {
  const headers = { "x-agent-token": token, "content-type": "application/json" };
  const snapshot = await buildSnapshot(c, provider);
  const ctxRes = await fetch(`${backendUrl}/api/agent/context`, { headers });
  const history = ctxRes.ok ? (await ctxRes.json()).history : [];
  let untrustedDocument = null;
  if (payload.injectInvoiceId) {
    const r = await fetch(`${backendUrl}/api/agent/invoice-text/${payload.injectInvoiceId}`, { headers });
    if (r.ok) untrustedDocument = (await r.json()).text;
  }
  const { system, user } = buildPrompt(snapshot, { history, untrustedDocument });
  const { json, meta } = await chatJson({ system, user, schema: PROPOSAL_SCHEMA, ...ollama });
  const proposal = {
    blockNumber: snapshot.blockNumber,
    snapshotHash: snapshotHash(snapshot),
    action: json.action,
    current: { ...snapshot.allocation },
    target: json.target,
    dataPoints: (json.dataPoints || []).map((d) => ({ name: d.name, value: d.value })),
    confidence: json.confidence,
    rationale: String(json.rationale || "").trim(),
    wouldChangeIf: String(json.wouldChangeIf || "").trim(),
  };
  const res = await fetch(`${backendUrl}/api/proposals`, {
    method: "POST", headers,
    body: JSON.stringify({ proposal, meta: { ...meta, ollamaVersion: await ollamaVersion(ollama.url), promptHash: hashOf({ system, user }), injected: Boolean(untrustedDocument) } }),
  });
  return { status: res.status, body: await res.json() };
}

async function main() {
  assertNoKeys();
  if (!config.agentToken) throw new Error("set AGENT_TOKEN in .env.agent (same value as in .env.backend)");
  const provider = makeProvider(config.rpcUrl);
  const c = contractsFor(provider, loadDeployment(config.network));
  console.log(`Kosha agent: model ${config.ollamaModel} at ${config.ollamaUrl}, no signing key loaded.`);
  const headers = { "x-agent-token": config.agentToken };
  const run = async (payload, jobId) => {
    try {
      const out = await runOnce({ provider, c, payload });
      console.log(`[agent] proposal ${out.body.id ?? "?"}: ${out.body.status} ${out.body.validation?.violations?.map((v) => v.rule).join(",") || ""}`);
      if (jobId) await fetch(`${config.backendUrl}/api/agent/requests/${jobId}/done`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ ok: true }) });
    } catch (e) {
      // AI-12: no proposal today. The vault keeps its current, always-legal split.
      console.error(`[agent] no proposal: ${e.message}`);
      if (jobId) await fetch(`${config.backendUrl}/api/agent/requests/${jobId}/done`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ ok: false, error: e.message }) }).catch(() => {});
    }
  };
  let lastDaily = 0;
  for (;;) {
    try {
      const r = await fetch(`${config.backendUrl}/api/agent/next`, { headers });
      if (r.status === 200) { const job = await r.json(); await run(job.payload, job.id); }
      else if (Date.now() - lastDaily > config.agentIntervalMs) { lastDaily = Date.now(); await run({}); }
    } catch (e) { console.error(`[agent] backend unreachable: ${e.message}`); }
    await new Promise((res) => setTimeout(res, config.agentPollMs));
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e.message); process.exit(1); });
