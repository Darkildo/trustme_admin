import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ErrorState } from "@/components/ErrorState";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/format";
import { reportQuery } from "@/lib/queries";
import { CheckGroups, CountsBar } from "./CheckGroups";

export function ReportDialog({
  nodeId,
  reportId,
  onClose,
}: {
  nodeId: string;
  reportId: string | null;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const q = useQuery({ ...reportQuery(nodeId, reportId ?? ""), enabled: reportId !== null });
  const r = q.data;
  return (
    <Dialog open={reportId !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>
            {r
              ? t("history.reportTitle", { date: formatDateTime(r.generated_at, i18n.language) })
              : t("common.loading")}
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">
            {r ? `tmnode ${r.tmnode_version} · ${r.id}` : " "}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {q.isPending ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-40" />
              ))}
            </div>
          ) : q.isError ? (
            <ErrorState error={q.error} onRetry={() => void q.refetch()} />
          ) : r ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
                  {Object.entries(r.target).map(([k, v]) =>
                    v ? (
                      <div key={k} className="flex gap-1.5">
                        <dt className="text-fg-subtle">{k}</dt>
                        <dd className="max-w-[24ch] truncate font-mono text-fg-muted" title={v}>
                          {v}
                        </dd>
                      </div>
                    ) : null,
                  )}
                </dl>
                <CountsBar counts={r.counts} />
              </div>
              <CheckGroups checks={r.checks} />
            </>
          ) : null}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
