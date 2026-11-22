// Small formatting helpers used everywhere. Indian number grouping throughout.

export function inr(amount: number | null | undefined, decimals = 0): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return "–";
  return "₹" + amount.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** ₹1.2 crore, ₹10.27 lakh: the way people in India say big amounts. */
export function inrWords(amount: number): string {
  if (amount >= 1e7) return `₹${trim(amount / 1e7)} crore`;
  if (amount >= 1e5) return `₹${trim(amount / 1e5)} lakh`;
  return inr(amount);
}

function trim(n: number): string {
  return n.toFixed(2).replace(/\.?0+$/, "");
}

export function pct(bps: number, decimals = 1): string {
  // 9001 bps -> "90%", 550 bps -> "5.5%" (or "5.50%" with decimals = 2 for rates)
  const text = (bps / 100).toFixed(decimals);
  return (decimals === 2 ? text : text.replace(/\.0+$/, "")) + "%";
}

export function shortAddr(address?: string | null): string {
  if (!address) return "";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function shortHash(hash?: string | null): string {
  if (!hash) return "";
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

/** Dates come from the chain (seconds). The demo chain lives on 20 Nov 2026. */
export function dateTime(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function dateOnly(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function duration(seconds: number): string {
  if (seconds <= 0) return "now";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h`;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export const ACTION_LABEL: Record<string, string> = {
  ALLOCATE_TO_GSEC: "Move money into government securities",
  REQUEST_FROM_GSEC: "Bring money back from government securities",
  NO_ACTION: "Keep the current split",
};
