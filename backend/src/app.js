import path from "node:path";
import express from "express";
import { config as baseConfig } from "./lib/config.js";
import { openDb, meta, wipe } from "./lib/db.js";
import { makeProvider, contractsFor, loadDeployment } from "./lib/chain.js";
import { getSigner } from "./lib/signer.js";
import { authRouter, session } from "./api/auth.js";
import { readRouter } from "./api/read.js";
import { proposalsRouter } from "./api/proposals.js";
import { opsRouter, ensureDemoSnapshot } from "./api/ops.js";
import { partnerRouter } from "./partner/routes.js";
import { startChaosProxy } from "./rpc-proxy.js";
import { startIndexer, indexOnce } from "./indexer.js";
import { startKeeper } from "./keeper.js";
import { startReconciler } from "./reconciler.js";

export async function createKosha(overrides = {}) {
  const config = { ...baseConfig, ...overrides };
  const provider = makeProvider(config.rpcUrl);
  const deployment = loadDeployment(config.network);
  const c = contractsFor(provider, deployment);
  const chainId = Number((await provider.getNetwork()).chainId);
  const db = openDb(config.dbPath);
  const chaos = startChaosProxy({ upstream: config.rpcUrl, port: config.chaosPort, vault: deployment.vault });
  const ctx = {
    config, provider, providerB: makeProvider(config.rpcUrlB), c, db, chainId, chaos, isLocal: chainId === 31337,
    docsDir: path.join(config.dataDir, "docs"), signer: (role) => getSigner(role, provider),
  };
  // A restarted chain or a new deployment makes the old index and the demo snapshot meaningless
  const fingerprint = (await provider.getBlock(deployment.deployBlock ?? 0)).hash;
  if (meta.get(db, "chain_fingerprint") !== fingerprint) {
    wipe(db);
    db.prepare("DELETE FROM meta").run();
    meta.set(db, "chain_fingerprint", fingerprint);
  }
  await indexOnce(db, c, provider);
  await ensureDemoSnapshot(ctx);

  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use((req, res, next) => {
    res.set("Access-Control-Allow-Origin", config.corsOrigin);
    res.set("Access-Control-Allow-Headers", "content-type, authorization, x-agent-token");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") return res.status(204).end();
    next();
  });
  app.use("/api", authRouter(ctx));
  app.use("/api", session(ctx));
  app.use("/api", readRouter(ctx));
  app.use("/api", proposalsRouter(ctx));
  app.use("/api", partnerRouter(ctx));
  app.use("/api", opsRouter(ctx));
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));

  const timers = [];
  ctx.app = app;
  ctx.startLoops = (log = console) => {
    timers.push(startIndexer(db, c, provider, config.indexIntervalMs, log));
    timers.push(startKeeper(ctx, config.keeperIntervalMs, log));
    timers.push(startReconciler(ctx, config.reconcileIntervalMs, log));
  };
  ctx.close = async () => { timers.forEach(clearInterval); await chaos.close(); provider.destroy(); ctx.providerB.destroy(); db.close(); };
  return ctx;
}
