import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const env = process.env;

export const config = {
  root: ROOT,
  port: Number(env.PORT || 4000),
  rpcUrl: env.RPC_URL || "http://127.0.0.1:8545",
  rpcUrlB: env.RPC_URL_B || `http://127.0.0.1:${env.CHAOS_PORT || 8546}`,
  chaosPort: Number(env.CHAOS_PORT || 8546),
  network: env.NETWORK || "localhost",
  deploymentsDir: env.DEPLOYMENTS_DIR || path.join(ROOT, "contracts", "deployments"),
  artifactsDir: env.ARTIFACTS_DIR || path.join(ROOT, "contracts", "artifacts", "contracts"),
  dataDir: env.DATA_DIR || path.join(ROOT, "data"),
  dbPath: env.DB_PATH || path.join(ROOT, "backend", "kosha.db"),
  ollamaUrl: env.OLLAMA_URL || "http://127.0.0.1:11434",
  ollamaModel: env.OLLAMA_MODEL || "qwen2.5:7b",
  ollamaTimeoutMs: Number(env.OLLAMA_TIMEOUT_MS || 60000),
  agentToken: env.AGENT_TOKEN || "",
  backendUrl: env.BACKEND_URL || "http://127.0.0.1:4000",
  indexIntervalMs: Number(env.INDEX_INTERVAL_MS || 2000),
  keeperIntervalMs: Number(env.KEEPER_INTERVAL_MS || 15000),
  reconcileIntervalMs: Number(env.RECONCILE_INTERVAL_MS || 60000),
  agentIntervalMs: Number(env.AGENT_INTERVAL_MS || 24 * 3600 * 1000),
  agentPollMs: Number(env.AGENT_POLL_MS || 5000),
  corsOrigin: env.CORS_ORIGIN || "http://localhost:3000",
};
