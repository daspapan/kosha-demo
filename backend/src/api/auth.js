// Sign-in with Ethereum, kept minimal: the wallet signs a nonce, the backend reads its roles from the chain.
import { randomBytes } from "node:crypto";
import { Router } from "express";
import { verifyMessage, getAddress, id as keccakId } from "ethers";

const NONCE_TTL = 5 * 60 * 1000, SESSION_TTL = 12 * 3600 * 1000;

export const signInMessage = (address, chainId, nonce) =>
  `Sign in to Kosha (local demo)\nAddress: ${address}\nChain ID: ${chainId}\nNonce: ${nonce}\nThis signature does not move any money.`;

export async function rolesOf(c, address) {
  const [partner, keeper, pauser, committee, verified, shares] = await Promise.all([
    c.vault.hasRole(keccakId("PARTNER_ROLE"), address), c.vault.hasRole(keccakId("KEEPER_ROLE"), address),
    c.vault.hasRole(keccakId("PAUSER_ROLE"), address), c.multisig.isOwner(address), c.kyc.isVerified(address), c.vault.balanceOf(address),
  ]);
  return { partner, keeper, pauser, committee, verified, member: verified && shares > 0n };
}

export function authRouter(ctx) {
  const r = Router();
  const nonces = new Map();
  ctx.sessions = new Map();

  r.post("/auth/nonce", (req, res) => {
    let address;
    try { address = getAddress(req.body.address); } catch { return res.status(400).json({ error: "valid address required" }); }
    const nonce = randomBytes(16).toString("hex");
    nonces.set(address, { nonce, exp: Date.now() + NONCE_TTL });
    res.json({ nonce, message: signInMessage(address, ctx.chainId, nonce) });
  });

  r.post("/auth/verify", async (req, res) => {
    let address;
    try { address = getAddress(req.body.address); } catch { return res.status(400).json({ error: "valid address required" }); }
    const n = nonces.get(address);
    if (!n || n.exp < Date.now()) return res.status(401).json({ error: "nonce expired, request a new one" });
    let signer;
    try { signer = verifyMessage(signInMessage(address, ctx.chainId, n.nonce), req.body.signature); } catch { return res.status(401).json({ error: "bad signature" }); }
    if (signer !== address) return res.status(401).json({ error: "signature does not match address" });
    nonces.delete(address);
    const token = randomBytes(24).toString("hex");
    ctx.sessions.set(token, { address, exp: Date.now() + SESSION_TTL });
    res.json({ token, address, roles: await rolesOf(ctx.c, address) });
  });
  return r;
}

/** Attaches req.user = { address, roles } when a valid bearer token is present. */
export function session(ctx) {
  return async (req, _res, next) => {
    const token = (req.get("authorization") || "").replace(/^Bearer /, "");
    const s = token && ctx.sessions?.get(token);
    if (s && s.exp > Date.now()) req.user = { address: s.address, roles: await rolesOf(ctx.c, s.address) };
    next();
  };
}

export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: "sign in first" });
  if (roles.length && !roles.some((r) => req.user.roles[r])) return res.status(403).json({ error: `needs role: ${roles.join(" or ")}` });
  next();
};

export const requireAgent = (ctx) => (req, res, next) => {
  if (!ctx.config.agentToken || req.get("x-agent-token") !== ctx.config.agentToken) return res.status(401).json({ error: "agent token required" });
  next();
};
