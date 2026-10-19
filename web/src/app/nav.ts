import {
  LayoutDashboard,
  PhoneCall,
  ScrollText,
  Server,
  Settings,
  SlidersHorizontal,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "@/lib/types";

export interface NavItem {
  to: "/" | "/nodes" | "/limits" | "/turn" | "/audit" | "/users" | "/settings";
  labelKey: string;
  icon: LucideIcon;
  min: Role;
  /** On phones only `primary` items sit in the bottom bar; the rest go under «Ещё». */
  mobile: "primary" | "more";
  /** Shorter label for the phone bottom bar. */
  shortLabelKey?: string;
  /** Extra words for the command palette search. */
  keywords?: string;
}

export const NAV_ITEMS: NavItem[] = [
  { to: "/", labelKey: "nav.overview", icon: LayoutDashboard, min: "viewer", mobile: "primary" },
  { to: "/nodes", labelKey: "nav.nodes", icon: Server, min: "viewer", mobile: "primary" },
  {
    to: "/limits",
    labelKey: "nav.limits",
    icon: SlidersHorizontal,
    min: "viewer",
    mobile: "primary",
    keywords: "limits profiles лимиты профили квоты",
  },
  {
    to: "/turn",
    labelKey: "nav.turn",
    shortLabelKey: "nav.turnShort",
    icon: PhoneCall,
    min: "viewer",
    mobile: "primary",
    keywords: "turn stun ice coturn calls звонки",
  },
  { to: "/audit", labelKey: "nav.audit", icon: ScrollText, min: "admin", mobile: "more" },
  { to: "/users", labelKey: "nav.users", icon: Users, min: "owner", mobile: "more" },
  { to: "/settings", labelKey: "nav.settings", icon: Settings, min: "viewer", mobile: "more" },
];
