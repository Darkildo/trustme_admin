import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, Info, LoaderCircle, WandSparkles, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useCan } from "@/app/useCurrentUser";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast-store";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { formatBytes } from "@/lib/format";
import { blobReserveQuery, qk } from "@/lib/queries";
import { TONE_CLASSES } from "@/lib/tone";
import type { Check, NodeDetail } from "@/lib/types";
import { cn } from "@/lib/utils";
import { BLOB_RESERVE_ENV, blobReserveAction } from "./blobReserve";

/**
 * Действие под предупреждением `host.blob_reserve`: кнопка «Подобрать резерв» с
 * подтверждением, пометка «панель уже уменьшила резерв» или подсказка для ноды без агента.
 */
export function BlobReserveFix({
  node,
  check,
}: {
  node: Pick<NodeDetail, "id" | "name">;
  check: Check;
}) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const canAdmin = useCan("admin");
  const warn = check.status === "warn";
  const { data } = useQuery({ ...blobReserveQuery(node.id), enabled: warn });
  const size = (b: number | null) => (b === null ? "—" : formatBytes(b, i18n.language));

  const apply = useMutation({
    mutationFn: () => api.nodes.applyBlobReserve(node.id),
    onSuccess: (r) => {
      toast.success(t("blobReserve.applied", { name: node.name, size: size(r.reserve_bytes) }));
      void qc.invalidateQueries({ queryKey: qk.blobReserve(node.id) });
      void qc.invalidateQueries({ queryKey: qk.runtime(node.id) });
      void qc.invalidateQueries({ queryKey: qk.node(node.id) });
    },
    onError: (e) => toast.error(errorMessage(e, t)),
  });

  const action = blobReserveAction(check.status, data, canAdmin, check.data);

  if (action.kind === "no_agent") {
    return (
      <Note tone="unknown" icon={Info}>
        {t("blobReserve.noAgent")}{" "}
        <code className="rounded-xs border border-line bg-surface-2 px-1 font-mono text-[11.5px] break-words text-fg">
          {BLOB_RESERVE_ENV}
        </code>
      </Note>
    );
  }

  if (action.kind === "lowered") {
    return (
      <Note tone="ok" icon={CircleCheck}>
        {t(action.legacy ? "blobReserve.loweredLegacy" : "blobReserve.lowered", {
          panel: size(action.panel),
          reserve: size(action.reserve),
        })}
      </Note>
    );
  }

  if (action.kind !== "fix") return null;

  return (
    <div className="ml-7 flex flex-wrap items-center gap-x-3 gap-y-2">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="sm" disabled={apply.isPending}>
            {apply.isPending ? <LoaderCircle className="animate-spin" /> : <WandSparkles />}
            {apply.isPending ? t("blobReserve.applying") : t("blobReserve.cta")}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogTitle>{t("blobReserve.confirmTitle", { name: node.name })}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-2">
              <p className="font-medium text-fg tabular-nums">
                {t("blobReserve.confirmFromTo", { from: size(action.from), to: size(action.to) })}
              </p>
              <p className="tabular-nums">
                {t("blobReserve.confirmDisk", {
                  total: size(data?.total_bytes ?? null),
                  available: size(data?.available_bytes ?? null),
                })}
              </p>
              <p>{t("blobReserve.confirmRule")}</p>
            </div>
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => apply.mutate()}>
              {t("blobReserve.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <span className="text-xs text-fg-subtle tabular-nums">
        {t("blobReserve.suggested", { size: size(action.to) })}
      </span>
    </div>
  );
}

function Note({
  tone,
  icon: Icon,
  children,
}: {
  tone: "ok" | "unknown";
  icon: LucideIcon;
  children: ReactNode;
}) {
  const c = TONE_CLASSES[tone];
  return (
    <div className={cn("ml-7 flex items-start gap-2 rounded-md border px-3 py-2", c.border, c.bg)}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", c.text)} aria-hidden />
      <p className="text-[13px] text-fg">{children}</p>
    </div>
  );
}
