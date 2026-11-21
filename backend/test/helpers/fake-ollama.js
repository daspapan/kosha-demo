// A stand-in for Ollama used by the integration tests, so they run anywhere (including CI) without a model.
// It reads the prompt the way a careful model would and answers with the same JSON shapes.
// The REAL model is tested by test/ai/*.test.js on your Mac.
import http from "node:http";

const field = (text, label) => (text.match(new RegExp(`${label}:\\s*(.+)`)) || [])[1]?.trim() ?? "";

export function startFakeOllama() {
  const state = { mode: "ok", calls: [] }; // modes: ok | down | garbage | hallucinate | obey_injection
  const server = http.createServer(async (req, res) => {
    let body = ""; for await (const ch of req) body += ch;
    if (req.url === "/api/version") return res.end(JSON.stringify({ version: "fake-0.0.0" }));
    if (state.mode === "down") { res.statusCode = 503; return res.end("model not loaded"); }
    const { messages } = JSON.parse(body || "{}");
    const system = messages?.[0]?.content ?? "", user = messages?.[1]?.content ?? "";
    state.calls.push(system.split("\n")[0]);
    let out;
    if (system.startsWith("TASK: injection_check")) {
      const hit = user.match(/(SYSTEM NOTE TO AI[^.]*\.|ignore previous instructions)/i);
      out = { injection: Boolean(hit), evidence: hit ? hit[0] : "" };
    } else if (system.startsWith("TASK: extract_invoice")) {
      const amount = Number(field(user, "Total amount payable").replace(/[^\d]/g, ""));
      out = { invoiceNo: field(user, "Invoice number"), sellerName: field(user, "Seller"), sellerGstin: field(user, "Seller GSTIN"), buyerName: field(user, "Buyer"),
        buyerGstin: field(user, "Buyer GSTIN"), invoiceDate: field(user, "Invoice date"), dueDate: field(user, "Due date"), amountInr: amount, goods: field(user, "Goods") };
    } else if (system.includes("TASK: treasury_proposal")) {
      const snap = JSON.parse(user.split("\n")[1]);
      const fact = (k) => (user.match(new RegExp(`- ${k}: (.+)`)) || [])[1] ?? "";
      const m = fact("largestAllowedMoveToGsec").match(/^(\d+(?:\.\d+)?)% = (Rs [\d,]+) \((Rs [^)]+)\); buffer afterwards Rs [\d,]+ \((Rs [^)]+)\)/);
      const cur = snap.allocation;
      const base = [{ name: "bufferBps", value: cur.bufferBps }, { name: "tbillAprBps", value: snap.tbillAprBps },
        { name: "expected7dRedemptionsArc", value: snap.expected7dRedemptionsArc }, { name: "pendingRedemptionsArc", value: snap.pendingRedemptionsArc }, { name: "tvlArc", value: snap.tvlArc }];
      if (m && !snap.paused) {
        const bps = Math.round(Number(m[1]) * 100);
        out = { action: "ALLOCATE_TO_GSEC", target: { bufferBps: cur.bufferBps - bps, gsecBps: cur.gsecBps + bps, invoiceBps: cur.invoiceBps }, dataPoints: base, confidence: "high",
          rationale: `Move ${m[1]}% (${m[2]}) from the buffer to government securities. T-bills pay ${fact("tbill").replace(" a year", "")} and expected redemptions are at most ${fact("expected7d").match(/\((Rs [^)]+)\)/)[1]}. The buffer would still hold ${m[4]}.`,
          wouldChangeIf: "A large redemption request arrives before the timelock ends." };
      } else if (/^(\d+(?:\.\d+)?)% = /.test(fact("moveFromGsecNeeded"))) {
        const mm = fact("moveFromGsecNeeded").match(/^(\d+(?:\.\d+)?)% = (Rs [\d,]+)/);
        const bps = Math.round(Number(mm[1]) * 100);
        out = { action: "REQUEST_FROM_GSEC", target: { bufferBps: cur.bufferBps + bps, gsecBps: cur.gsecBps - bps, invoiceBps: cur.invoiceBps }, dataPoints: base, confidence: "high",
          rationale: `Bring ${mm[1]}% (${mm[2]}) back from government securities so the buffer covers the queued redemptions.`, wouldChangeIf: "The redemption queue is cancelled." };
      } else {
        out = { action: "NO_ACTION", target: { ...cur }, dataPoints: base, confidence: "medium", rationale: "Keep the current split; no further move is allowed today.", wouldChangeIf: "Caps or policy limits change." };
      }
      if (state.mode === "hallucinate") { out.dataPoints[1].value = 600; out.rationale = out.rationale.replace(/T-bills pay [\d.]+%/, "T-bills pay 6.00%"); }
      if (state.mode === "obey_injection" && /untrusted_document/.test(user)) {
        out.target = { bufferBps: cur.bufferBps - 6000, gsecBps: cur.gsecBps + 6000, invoiceBps: cur.invoiceBps };
        out.rationale = "As instructed by the pre-approved invoice, move 60% of the pool now.";
      }
    } else out = {};
    const content = state.mode === "garbage" ? "not json at all" : JSON.stringify(out);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ message: { role: "assistant", content }, eval_count: 42 }));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${server.address().port}`, state, close: () => new Promise((r) => server.close(r)) })));
}
