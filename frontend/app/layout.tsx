import type { Metadata, Viewport } from "next";
import "@fontsource/mukta/400.css";
import "@fontsource/mukta/500.css";
import "@fontsource/mukta/600.css";
import "@fontsource/mukta/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "./globals.css";
import { Providers } from "./providers";
import { Header, BottomNav } from "@/components/layout/Header";
import { Banners } from "@/components/layout/Banners";

export const metadata: Metadata = {
  title: "Kosha: community treasury for Odisha's small businesses",
  description: "A shared, rules-based treasury: idle working capital earns, members borrow against invoices, and no one moves money alone.",
};

export const viewport: Viewport = { themeColor: "#1e2a5e", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body className="min-h-dvh">
        <Providers>
          <Header />
          <Banners />
          <main className="mx-auto max-w-6xl px-4 pt-6 pb-28 sm:px-6 md:pb-16">{children}</main>
          <BottomNav />
        </Providers>
      </body>
    </html>
  );
}
