// Ollama /api/chat with a JSON schema in `format`. temperature 0 + fixed seed for repeatable runs.
import { config } from "./config.js";

export class OllamaError extends Error {}

export async function chatJson({ system, user, schema, model = config.ollamaModel, url = config.ollamaUrl, timeoutMs = config.ollamaTimeoutMs, retries = 1 }) {
  const body = {
    model, stream: false, format: schema,
    options: { temperature: 0, seed: 42, num_ctx: 8192, num_predict: 1024 },
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
  };
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    body.options.seed = 42 + attempt;
    const started = Date.now();
    try {
      const res = await fetch(`${url}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new OllamaError(`Ollama HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      const json = JSON.parse(data.message?.content ?? "");
      return { json, meta: { model, latencyMs: Date.now() - started, options: body.options, evalCount: data.eval_count ?? null } };
    } catch (e) {
      lastErr = e instanceof OllamaError ? e : new OllamaError(e.name === "TimeoutError" ? `Ollama timed out after ${timeoutMs} ms` : `Ollama call failed: ${e.message}`);
    }
  }
  throw lastErr;
}

export async function ollamaVersion(url = config.ollamaUrl) {
  try { const r = await fetch(`${url}/api/version`, { signal: AbortSignal.timeout(3000) }); return (await r.json()).version; } catch { return null; }
}
