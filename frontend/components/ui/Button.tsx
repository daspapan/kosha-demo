import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Loader2 } from "lucide-react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-ink text-white hover:bg-[#162048] disabled:bg-ink-faint",
  secondary: "bg-surface text-ink border border-line hover:border-ink-faint disabled:text-ink-faint",
  ghost: "text-ink-soft hover:text-ink hover:bg-paper",
  danger: "bg-danger text-white hover:bg-[#8f1c13] disabled:opacity-60",
};
const SIZES: Record<Size, string> = { sm: "h-9 px-3 text-sm", md: "h-11 px-4 text-[15px]" };

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; busy?: boolean; icon?: ReactNode };

export function Button({ variant = "primary", size = "md", busy = false, icon, className = "", children, disabled, ...rest }: Props) {
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      className={`inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] font-semibold transition-colors disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
    >
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}
