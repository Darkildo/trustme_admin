import { useQuery } from "@tanstack/react-query";
import { ArrowUpCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ErrorState } from "@/components/ErrorState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime, formatRelative } from "@/lib/format";
import { nodeUpdatesQuery } from "@/lib/queries";
import { TONE_CLASSES } from "@/lib/tone";
import { cn } from "@/lib/utils";
import { imageTag, isProblem, updateStateMeta } from "./updates";
import { useTargetLabel } from "./useTargetLabel";

/** История обновлений ноды на вкладке «История». */
export function UpdateHistory({ nodeId }: { nodeId: string }) {
  const { t, i18n } = useTranslation();
  const q = useQuery(nodeUpdatesQuery(nodeId));
  const target = useTargetLabel();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("updates.history.title")}</CardTitle>
      </CardHeader>
      <CardContent className="px-0 sm:px-0">
        {q.isPending ? (
          <div className="flex flex-col gap-2 px-4">
            {Array.from({ length: 2 }, (_, i) => (
              <Skeleton key={i} className="h-11" />
            ))}
          </div>
        ) : q.isError ? (
          <div className="px-4">
            <ErrorState error={q.error} onRetry={() => void q.refetch()} />
          </div>
        ) : q.data.updates.length === 0 ? (
          <p className="flex items-center gap-2 px-5 py-6 text-sm text-fg-subtle">
            <ArrowUpCircle className="size-4" aria-hidden />
            {t("updates.history.empty")}
          </p>
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {q.data.updates.map((u) => {
              const meta = updateStateMeta(u.state);
              const Icon = meta.icon;
              const from = [imageTag(u.from_node_image), u.from_tmnode && `tmnode ${u.from_tmnode}`]
                .filter(Boolean)
                .join(" · ");
              return (
                <li key={u.id} className="flex flex-col gap-1.5 px-4 py-2.5 sm:px-5">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span
                      className={cn(
                        "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs font-medium text-fg",
                        TONE_CLASSES[meta.tone].border,
                        TONE_CLASSES[meta.tone].bg,
                      )}
                    >
                      <Icon
                        className={cn(
                          "size-3.5",
                          TONE_CLASSES[meta.tone].text,
                          meta.spinning && "animate-spin",
                        )}
                        aria-hidden
                      />
                      {t(`updates.state.${u.state}`)}
                    </span>
                    <span className="font-mono text-[13px] text-fg">{target(u)}</span>
                    {from && (
                      <span className="font-mono text-xs text-fg-subtle">
                        {t("updates.history.from", { from })}
                      </span>
                    )}
                    <span
                      className="ml-auto text-xs text-fg-subtle tabular"
                      title={formatDateTime(u.created_at, i18n.language)}
                    >
                      {t("updates.progress.meta", {
                        user: u.created_by ?? "—",
                        ago: formatRelative(u.created_at, i18n.language),
                      })}
                    </span>
                  </div>
                  {isProblem(u.state) && u.error && (
                    <p className="font-mono text-xs break-words text-fg-muted">
                      {u.step && (
                        <span className="text-fail">{t(`updates.steps.${u.step}`)}: </span>
                      )}
                      {u.error}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
