import {
  LayoutDashboard,
  ScrollText,
  Server,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "@/lib/types";

export interface NavItem {
  to: "/" | "/nodes" | "/audit" | "/users" | "/settings";
  labelKey: string;
  icon: LucideIcon;
  min: Role;
}

export const NAV_ITEMS: NavItem[] = [
  { to: "/", labelKey: "nav.overview", icon: LayoutDashboard, min: "viewer" },
  { to: "/nodes", labelKey: "nav.nodes", icon: Server, min: "viewer" },
  { to: "/audit", labelKey: "nav.audit", icon: ScrollText, min: "admin" },
  { to: "/users", labelKey: "nav.users", icon: Users, min: "owner" },
  { to: "/settings", labelKey: "nav.settings", icon: Settings, min: "viewer" },
];
