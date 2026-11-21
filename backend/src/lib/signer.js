// The only place private keys are read. Swap to AWS KMS by adding a KmsSigner branch.
import { Wallet, NonceManager } from "ethers";

const ROLES = ["partner", "keeper", "reconciler", "issuer", "rbi"];
const cache = new Map();

export function getSigner(role, provider) {
  if (!ROLES.includes(role)) throw new Error(`unknown signer role ${role}`);
  if (process.env.SIGNER_MODE === "kms") throw new Error("KMS signer not wired in the local demo");
  const key = process.env[`${role.toUpperCase()}_PRIVATE_KEY`];
  if (!key) throw new Error(`no key for ${role}: set ${role.toUpperCase()}_PRIVATE_KEY in .env.backend`);
  const k = `${role}:${key}`;
  if (!cache.has(k)) cache.set(k, new NonceManager(new Wallet(key, provider)));
  return cache.get(k);
}

export function resetSigners() {
  for (const s of cache.values()) s.reset();
}
