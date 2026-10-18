import { Link } from "@tanstack/react-router";
import { ArrowRight, TriangleAlert, Activity } from "lucide-react";
import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDateTime, formatRelative } from "@/lib/format";
import type { OverviewEvent } from "@/lib/types";
import { useNow } from "@/lib/useNow";

export function Events({ events }: { events: OverviewEvent[] }) {
  const { t, i18n } = useTranslation();
  const now = useNow(30_000);
  if (events.length === 0) {
    return (
      <p className="flex items-center gap-2 py-8 text-sm text-fg-subtle">
        <Activity className="size-4" aria-hidden />
        {t("overview.noEvents")}
      </p>
    );
  }
  return (
    <ol className="relative flex flex-col">
      <span aria-hidden className="absolute top-2 bottom-2 left-[11px] w-px bg-line" />
      {events.map((e, i) => (
        <li key={`${e.at}-${e.node_id}-${i}`} className="relative flex gap-3 py-2.5">
          <span className="relative z-10 mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-line-strong bg-surface-1">
            {e.kind === "report_problem" ? (
              <TriangleAlert
                className="size-3.5 text-warn"
                aria-label={t("events.report_problem")}
              />
            ) : (
              <Activity className="size-3.5 text-accent" aria-label={t("events.status_changed")} />
            )}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-start gap-2">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                <Link
                  to="/nodes/$id"
                  params={{ id: e.node_id }}
                  className="text-sm font-medium text-fg hover:text-accent"
                >
                  {e.node_name}
                </Link>
                {e.kind === "status_changed" && e.from && e.to && (
                  <span className="flex items-center gap-1">
                    <StatusBadge status={e.from} size="sm" />
                    <ArrowRight className="size-3 text-fg-subtle" aria-hidden />
                    <StatusBadge status={e.to} size="sm" />
                  </span>
                )}
              </div>
              <time
                dateTime={new Date(e.at * 1000).toISOString()}
                title={formatDateTime(e.at, i18n.language)}
                className="shrink-0 pt-0.5 text-xs whitespace-nowrap text-fg-subtle tabular"
              >
                {formatRelative(e.at, i18n.language, now / 1000)}
              </time>
            </div>
            <p className="text-[13px] text-fg-muted">{e.summary}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
