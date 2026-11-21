import { createKosha } from "./app.js";

const ctx = await createKosha();
ctx.startLoops();
ctx.app.listen(ctx.config.port, () => {
  console.log(`Kosha backend on http://localhost:${ctx.config.port}  chain ${ctx.chainId}  vault ${ctx.c.addresses.vault}`);
  console.log(`Chaos RPC proxy on :${ctx.config.chaosPort}. Demo controls ${ctx.isLocal ? "ON" : "off"}.`);
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => { await ctx.close(); process.exit(0); });
