import { formatUnits, parseUnits } from "ethers";

/** 18-decimal token amount -> whole rupees (floor), as a Number. Safe up to Rs 9e15. */
export const toRupees = (wei) => Number(BigInt(wei) / 10n ** 18n);
export const toRupeesExact = (wei) => Number(formatUnits(BigInt(wei), 18));
export const rupees = (n) => parseUnits(String(n), 18);
export const fmtINR = (n) => "Rs " + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
