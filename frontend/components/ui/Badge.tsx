import type { ReactNode } from "react";

export type Tone = "neutral" | "ok" | "warn" | "danger" | "info";

const TONES: Record<Tone, string> = {
  neutral: "bg-[#eceef6] text-ink-soft",
  ok: "bg-[#e3f2ef] text-[#155c51]",
  warn: "bg-[#fbf0d9] text-[#7a4f0c]",
  danger: "bg-[#fbe6e4] text-danger",
  info: "bg-[#e7e9f7] text-gsec",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[13px] font-semibold whitespace-nowrap ${TONES[tone]}`}>{children}</span>;
}
