// Second RPC path for the reconciler. In the demo it can be told to misbehave.
//   stale: answers block queries from 10 blocks back      lie: adds 1 wei to vault.totalAssets()
import express from "express";

export function startChaosProxy({ upstream, port, vault }) {
  const state = { mode: "off" };
  const TOTAL_ASSETS = "0x01e1d114"; // totalAssets() selector
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  const call = async (body) => (await fetch(upstream, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();

  async function handle(req) {
    if (state.mode === "stale") {
      if (req.method === "eth_blockNumber") { const r = await call(req); return { ...r, result: "0x" + Math.max(0, parseInt(r.result, 16) - 10).toString(16) }; }
      if (req.method === "eth_getBlockByNumber" && /^0x/.test(req.params[0])) {
        const n = Math.max(0, parseInt(req.params[0], 16) - 10);
        return call({ ...req, params: ["0x" + n.toString(16), ...req.params.slice(1)] });
      }
    }
    const res = await call(req);
    if (state.mode === "lie" && req.method === "eth_call" && req.params?.[0]?.to?.toLowerCase() === vault.toLowerCase() && req.params[0].data?.startsWith(TOTAL_ASSETS) && res.result) {
      return { ...res, result: "0x" + (BigInt(res.result) + 1n).toString(16).padStart(64, "0") };
    }
    return res;
  }
  app.post("/", async (req, res) => {
    try { res.json(Array.isArray(req.body) ? await Promise.all(req.body.map(handle)) : await handle(req.body)); }
    catch (e) { res.status(502).json({ jsonrpc: "2.0", id: req.body?.id ?? null, error: { code: -32000, message: e.message } }); }
  });
  const server = app.listen(port);
  return { state, close: () => new Promise((r) => server.close(r)) };
}
