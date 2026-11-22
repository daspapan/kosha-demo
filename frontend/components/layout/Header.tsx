"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "./Logo";
import { NAV } from "./nav";
import { WalletButton } from "./WalletButton";
import { DemoSwitcher } from "./DemoSwitcher";
import { DEMO_MODE } from "@/lib/demoAccounts";
import { useConfig } from "@/lib/hooks";

export function Header() {
  const path = usePathname();
  const { data: config } = useConfig();
  const items = NAV.filter((n) => n.href !== "/ops" || config?.demo);
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <Logo />
          <span className="text-xl font-bold tracking-tight">Kosha</span>
        </Link>
        <nav aria-label="Main" className="hidden flex-1 items-center gap-1 md:flex">
          {items.map((n) => {
            const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined}
                className={`rounded-lg px-3 py-2 text-[15px] font-semibold ${active ? "bg-paper text-ink" : "text-ink-soft hover:text-ink"}`}>
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto">{DEMO_MODE ? <DemoSwitcher /> : <WalletButton />}</div>
      </div>
    </header>
  );
}

/** Phones: the same destinations as a bottom tab bar. */
export function BottomNav() {
  const path = usePathname();
  const { data: config } = useConfig();
  const items = NAV.filter((n) => n.href !== "/ops" || config?.demo);
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
        {items.map((n) => {
          const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
          const Icon = n.icon;
          return (
            <li key={n.href}>
              <Link href={n.href} aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold ${active ? "text-ink" : "text-ink-faint"}`}>
                <Icon className="size-5" aria-hidden />
                {"short" in n ? n.short : n.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
