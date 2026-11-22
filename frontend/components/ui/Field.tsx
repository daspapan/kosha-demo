import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && <span className="mt-1 block text-sm text-ink-soft">{hint}</span>}
    </label>
  );
}

const base = "w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 text-[15px] text-ink placeholder:text-ink-faint focus:border-gsec focus:outline-none";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${base} h-11 ${props.className ?? ""}`} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${base} min-h-24 py-2 ${props.className ?? ""}`} />;
}

/** Rupee amount input: digits only, with the ₹ sign inside the box. */
export function AmountInput({ value, onChange, max, id }: { value: string; onChange: (v: string) => void; max?: number; id?: string }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-soft">₹</span>
      <Input id={id} inputMode="numeric" value={value} placeholder="0" onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ""))} className="num pl-7 pr-20" />
      {max !== undefined && max > 0 && (
        <button type="button" onClick={() => onChange(String(Math.floor(max)))} className="absolute inset-y-1.5 right-1.5 rounded-md px-2 text-sm font-semibold text-gsec hover:bg-paper">
          Max
        </button>
      )}
    </div>
  );
}
