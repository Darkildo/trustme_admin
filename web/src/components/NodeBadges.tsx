import { Hourglass } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Tooltip } from "@/components/ui/tooltip";
import { agentPresence } from "@/features/nodes/runtime";
import { formatRelative } from "@/lib/format";
import type { NodeListItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { LiveDot } from "./LiveDot";
import { StatusBadge } from "./StatusBadge";

/** «Ожидает установки»: the node is prepared in the panel, its agent has not enrolled yet. */
export function ProvisioningBadge({
  size = "md",
  className,
}: {
  size?: "sm" | "md";
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <span
      data-status="provisioning"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-dashed border-accent-2/50 bg-accent-2/10 font-medium whitespace-nowrap text-accent-2",
        size === "sm" ? "h-5 px-2 text-[11px]" : "h-6 px-2.5 text-xs",
        className,
      )}
    >
      <Hourglass className={size === "sm" ? "size-3" : "size-3.5"} aria-hidden strokeWidth={2.25} />
      {t("status.provisioning")}
    </span>
  );
}

/** Status pill that knows about provisioning nodes. */
export function NodeStatusBadge({
  node,
  size,
  className,
}: {
  node: Pick<NodeListItem, "status" | "provisioning">;
  size?: "sm" | "md";
  className?: string;
}) {
  return node.provisioning ? (
    <ProvisioningBadge size={size} className={className} />
  ) : (
    <StatusBadge status={node.status} size={size} className={className} />
  );
}

/** Small agent indicator: pulsing when the last heartbeat is within 90 s, hollow otherwise. */
export function AgentDot({
  node,
  nowSec,
  className,
}: {
  node: Pick<NodeListItem, "agent">;
  nowSec: number;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const presence = agentPresence(node, nowSec);
  if (presence === "none" || !node.agent) return null;
  const hostname = node.agent.hostname;
  const label =
    presence === "online"
      ? t("status.agentOnline", { hostname })
      : node.agent.last_seen_at
        ? t("status.agentOfflineSince", {
            hostname,
            ago: formatRelative(node.agent.last_seen_at, i18n.language, nowSec),
          })
        : t("status.agentOffline", { hostname });
  return (
    <Tooltip content={label}>
      <span
        role="img"
        aria-label={label}
        tabIndex={0}
        data-agent={presence}
        className={cn(
          "inline-flex size-4 shrink-0 items-center justify-center rounded-full",
          className,
        )}
      >
        {presence === "online" ? (
          <LiveDot tone="ok" />
        ) : (
          <span className="size-2 rounded-full border-[1.5px] border-fg-subtle" />
        )}
      </span>
    </Tooltip>
  );
}
