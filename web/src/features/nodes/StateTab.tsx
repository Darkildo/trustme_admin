import { Clock, FileText, Plug } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatRelative } from "@/lib/format";
import type { NodeDetail } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { CheckGroups, CountsBar } from "./CheckGroups";

const STALE_SECS = 3 * 3600;

export function StateTab({ node, onConnect }: { node: NodeDetail; onConnect: () => void }) {
  const { t, i18n } = useTranslation();
  const now = useNow(30_000) / 1000;
  const report = node.latest_report;

  if (!report) {
    return (
      <EmptyState
        icon={FileText}
        title={t("checks.emptyTitle")}
        text={t("checks.emptyText")}
        action={
          <Button variant="primary" onClick={onConnect}>
            <Plug />
            {t("checks.emptyCta")}
          </Button>
        }
      />
    );
  }

  const stale = now - report.generated_at > STALE_SECS;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p
          className="text-sm text-fg-muted"
          title={formatDateTime(report.generated_at, i18n.language)}
        >
          {t("checks.reportMeta", {
            version: report.tmnode_version,
            ago: formatRelative(report.generated_at, i18n.language, now),
          })}
        </p>
        <CountsBar counts={report.counts} />
      </div>
      {stale && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-md border border-stale/30 bg-stale-soft px-3 py-2.5 text-sm text-fg"
        >
          <Clock className="mt-0.5 size-4 shrink-0 text-stale" aria-hidden />
          {t("checks.staleWarn")}
        </div>
      )}
      <CheckGroups checks={report.checks} />
    </div>
  );
}
