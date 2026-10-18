import { useTranslation } from "react-i18next";
import { checkStatusMeta, nodeStatusMeta } from "@/lib/status";
import { TONE_CLASSES } from "@/lib/tone";
import type { CheckStatus, NodeStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: NodeStatus;
  size?: "sm" | "md";
  className?: string;
}

/** Node status pill: icon + label, colour from the tone tokens. */
export function StatusBadge({ status, size = "md", className }: StatusBadgeProps) {
  const { t } = useTranslation();
  const meta = nodeStatusMeta(status);
  const tone = TONE_CLASSES[meta.tone];
  const Icon = meta.icon;
  return (
    <span
      data-tone={meta.tone}
      data-status={status}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap",
        size === "sm" ? "h-5 px-2 text-[11px]" : "h-6 px-2.5 text-xs",
        tone.text,
        tone.bg,
        tone.border,
        className,
      )}
    >
      <Icon className={size === "sm" ? "size-3" : "size-3.5"} aria-hidden strokeWidth={2.25} />
      {t(meta.labelKey)}
    </span>
  );
}

/** Icon-only node status with an accessible label. */
export function StatusIcon({ status, className }: { status: NodeStatus; className?: string }) {
  const { t } = useTranslation();
  const meta = nodeStatusMeta(status);
  const Icon = meta.icon;
  return (
    <Icon
      role="img"
      aria-label={t(meta.labelKey)}
      data-tone={meta.tone}
      className={cn("size-4 shrink-0", TONE_CLASSES[meta.tone].text, className)}
      strokeWidth={2.25}
    />
  );
}

export function CheckStatusIcon({
  status,
  className,
}: {
  status: CheckStatus;
  className?: string;
}) {
  const { t } = useTranslation();
  const meta = checkStatusMeta(status);
  const Icon = meta.icon;
  return (
    <Icon
      role="img"
      aria-label={t(meta.labelKey)}
      data-tone={meta.tone}
      className={cn("size-4 shrink-0", TONE_CLASSES[meta.tone].text, className)}
      strokeWidth={2.25}
    />
  );
}

export function CheckStatusBadge({
  status,
  className,
}: {
  status: CheckStatus;
  className?: string;
}) {
  const { t } = useTranslation();
  const meta = checkStatusMeta(status);
  const tone = TONE_CLASSES[meta.tone];
  const Icon = meta.icon;
  return (
    <span
      data-tone={meta.tone}
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-full border px-2 text-[11px] font-medium whitespace-nowrap",
        tone.text,
        tone.bg,
        tone.border,
        className,
      )}
    >
      <Icon className="size-3" aria-hidden strokeWidth={2.25} />
      {t(meta.labelKey)}
    </span>
  );
}
