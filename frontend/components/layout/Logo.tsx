/** Kosha mark: three woven threads in the pocket colours, a nod to ikat weaving. */
export function Logo({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#1e2a5e" />
      <path d="M6 11h20" stroke="#1f7a6c" strokeWidth="4" strokeLinecap="round" />
      <path d="M6 16h20" stroke="#6f7fe0" strokeWidth="4" strokeLinecap="round" strokeDasharray="5 3" />
      <path d="M6 21h20" stroke="#d99a1e" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}
