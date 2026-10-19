import {
  FolderArchive,
  MessagesSquare,
  MonitorSmartphone,
  Network,
  Phone,
  Plug,
  Power,
  ShieldCheck,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { Tone } from "@/lib/status";
import type { Scope, SettingGroup } from "@/lib/types";

export const GROUP_ORDER: readonly SettingGroup[] = [
  "messages",
  "sessions",
  "network",
  "blobs",
  "security",
  "calls",
];

export const GROUP_ICONS: Record<SettingGroup, LucideIcon> = {
  messages: MessagesSquare,
  sessions: MonitorSmartphone,
  network: Network,
  blobs: FolderArchive,
  security: ShieldCheck,
  calls: Phone,
};

export const SCOPE_META: Record<Scope, { tone: Tone; icon: LucideIcon }> = {
  hot: { tone: "ok", icon: Zap },
  new_sessions: { tone: "stale", icon: Plug },
  restart: { tone: "warn", icon: Power },
};
