import { useInfiniteQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/format";
import { auditQuery } from "@/lib/queries";
import type { AuditEntry } from "@/lib/types";
import { cn } from "@/lib/utils";

function actionTone(action: string): string {
  if (action === "auth.login_failed" || action.endsWith("deleted"))
    return "text-fail bg-fail-soft border-fail/30";
  if (
    action.endsWith("token_rotated") ||
    action.startsWith("auth.totp") ||
    action === "auth.password_changed"
  )
    return "text-warn bg-warn-soft border-warn/30";
  if (action.startsWith("node.")) return "text-accent bg-accent-soft border-accent/30";
  return "text-fg-muted bg-surface-2 border-line";
}

function Details({ details }: { details: Record<string, unknown> }) {
  const entries = Object.entries(details);
  if (entries.length === 0) return <span className="text-fg-subtle">—</span>;
  return (
    <span className="font-mono text-[11.5px] break-all text-fg-muted">
      {entries.map(([k, v], i) => (
        <span key={k}>
          {i > 0 && " · "}
          <span className="text-fg-subtle">{k}=</span>
          {typeof v === "string" ? v : JSON.stringify(v)}
        </span>
      ))}
    </span>
  );
}

export function AuditPage() {
  const { t, i18n } = useTranslation();
  const q = useInfiniteQuery(auditQuery);
  const entries = useMemo<AuditEntry[]>(() => {
    const seen = new Set<string>();
    const out: AuditEntry[] = [];
    for (const page of q.data?.pages ?? []) {
      for (const e of page) {
        if (!seen.has(e.id)) {
          seen.add(e.id);
          out.push(e);
        }
      }
    }
    return out;
  }, [q.data]);

  const label = (action: string) =>
    t(`audit.actions.${action.replace(/\./g, "_")}`, { defaultValue: action });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("audit.title")} subtitle={t("audit.subtitle")} />
      {q.isPending ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-11" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : entries.length === 0 ? (
        <EmptyState icon={ScrollText} title={t("audit.empty")} />
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-lg border border-line bg-surface-1 md:block">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-bg-elevated text-left text-xs text-fg-subtle">
                <tr>
                  <th scope="col" className="py-2.5 pr-3 pl-4 font-medium">
                    {t("audit.time")}
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium">
                    {t("audit.user")}
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium">
                    {t("audit.action")}
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium">
                    {t("audit.target")}
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium">
                    {t("audit.details")}
                  </th>
                  <th scope="col" className="py-2.5 pr-4 pl-3 font-medium">
                    {t("audit.ip")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr
                    key={e.id}
                    className="border-b border-line align-top last:border-0 hover:bg-surface-2/60"
                  >
                    <td className="py-2.5 pr-3 pl-4 font-mono text-xs whitespace-nowrap text-fg-muted tabular">
                      {formatDateTime(e.at, i18n.language)}
                    </td>
                    <td className="px-3 py-2.5 text-fg">
                      {e.user ?? <span className="text-fg-subtle italic">{t("audit.system")}</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        title={e.action}
                        className={cn(
                          "inline-flex h-5 items-center rounded-full border px-2 text-[11px] font-medium whitespace-nowrap",
                          actionTone(e.action),
                        )}
                      >
                        {label(e.action)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-fg">
                      {e.target ?? <span className="text-fg-subtle">—</span>}
                    </td>
                    <td className="max-w-md px-3 py-2.5">
                      <Details details={e.details} />
                    </td>
                    <td className="py-2.5 pr-4 pl-3 font-mono text-xs text-fg-muted">
                      {e.ip ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="flex flex-col gap-2 md:hidden">
            {entries.map((e) => (
              <li
                key={e.id}
                className="flex flex-col gap-1.5 rounded-lg border border-line bg-surface-1 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      "inline-flex h-5 items-center rounded-full border px-2 text-[11px] font-medium",
                      actionTone(e.action),
                    )}
                  >
                    {label(e.action)}
                  </span>
                  <span className="font-mono text-[11px] text-fg-subtle tabular">
                    {formatDateTime(e.at, i18n.language)}
                  </span>
                </div>
                <p className="text-sm text-fg">
                  {e.user ?? <span className="text-fg-subtle italic">{t("audit.system")}</span>}
                  {e.target && (
                    <span className="font-mono text-xs text-fg-muted"> → {e.target}</span>
                  )}
                </p>
                <Details details={e.details} />
                {e.ip && <span className="font-mono text-[11px] text-fg-subtle">{e.ip}</span>}
              </li>
            ))}
          </ul>
          <div className="flex justify-center py-2">
            {q.hasNextPage ? (
              <Button
                variant="secondary"
                disabled={q.isFetchingNextPage}
                onClick={() => void q.fetchNextPage()}
              >
                {q.isFetchingNextPage ? t("common.loading") : t("common.loadMore")}
              </Button>
            ) : (
              <p className="text-xs text-fg-subtle">{t("audit.end")}</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
