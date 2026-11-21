import { createHash } from "node:crypto";

/** Deterministic JSON: sorted keys, bigint as decimal string, no whitespace. */
export function canonicalJSON(value) {
  if (value === null || typeof value !== "object") {
    if (typeof value === "bigint") return JSON.stringify(value.toString());
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJSON(value[k])}`).join(",")}}`;
}

export function sha256Hex(input) {
  return "0x" + createHash("sha256").update(input).digest("hex");
}

export const hashOf = (value) => sha256Hex(canonicalJSON(value));
export const proposalHashOf = (proposal, snapshot) => hashOf({ proposal, snapshot });
