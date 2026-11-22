import { Gavel, Landmark, ScrollText, SlidersHorizontal, UserRound, Building2 } from "lucide-react";

export const NAV = [
  { href: "/", label: "Pool", icon: Landmark },
  { href: "/member", label: "My account", short: "Account", icon: UserRound },
  { href: "/committee", label: "Committee", icon: Gavel },
  { href: "/partner", label: "Partner", icon: Building2 },
  { href: "/audit", label: "Audit", icon: ScrollText },
  { href: "/ops", label: "Demo controls", short: "Demo", icon: SlidersHorizontal },
] as const;
