import { Check, Fingerprint } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "@/components/ui/toast-store";
import { shortFingerprint } from "@/lib/format";
import { cn, copyText } from "@/lib/utils";

interface PinChipProps {
  nodeKey: string;
  fingerprint: string;
  /** Number of fingerprint groups to show; `full` shows all. */
  groups?: number | "full";
  className?: string;
}

/** One-click copy of the node pin (64 hex); shows the fingerprint. */
export function PinChip({ nodeKey, fingerprint, groups = 2, className }: PinChipProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(id);
  }, [copied]);
  const shown = groups === "full" ? fingerprint : shortFingerprint(fingerprint, groups);
  return (
    <button
      type="button"
      aria-label={t("nodes.copyPin", { fingerprint })}
      title={t("nodes.copyPin", { fingerprint })}
      onClick={async (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (await copyText(nodeKey)) {
          setCopied(true);
          toast.success(
            t("nodes.pinCopied", { fingerprint: shortFingerprint(fingerprint, 4) }),
            fingerprint,
          );
        } else {
          toast.error(t("common.copyFailed"));
        }
      }}
      className={cn(
        "group inline-flex h-7 max-w-full items-center gap-1.5 rounded-sm border border-line bg-surface-2 px-2 font-mono text-xs text-fg-muted transition-colors hover:border-accent/40 hover:text-fg",
        className,
      )}
    >
      {copied ? (
        <Check className="size-3.5 shrink-0 text-ok" aria-hidden />
      ) : (
        <Fingerprint className="size-3.5 shrink-0 text-accent" aria-hidden />
      )}
      <span className="truncate tabular">{shown}</span>
    </button>
  );
}
