import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, LoaderCircle } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useCan } from "@/app/useCurrentUser";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast-store";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { formatDateTime, formatRelative } from "@/lib/format";
import { nodeUpdatesQuery, qk } from "@/lib/queries";
import { TONE_CLASSES } from "@/lib/tone";
import { useNow } from "@/lib/useNow";
import { cn } from "@/lib/utils";
import { UpdateSteps } from "./UpdateSteps";
import { bannerUpdate, isActive, isProblem, updateStateMeta } from "./updates";
import { useTargetLabel } from "./useTargetLabel";

/**
 * Ход обновления над вкладками карточки: активное задание с шагами и отменой, пока
 * агент не начал, или недавний итог (ошибку показывает дольше, чем успех).
 */
export function UpdateBanner({ nodeId, enabled }: { nodeId: string; enabled: boolean }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const canAdmin = useCan("admin");
  const now = useNow(15_000) / 1000;
  const q = useQuery({ ...nodeUpdatesQuery(nodeId), enabled });
  const target = useTargetLabel();
  const update = bannerUpdate(q.data?.updates, now);

  // Задание закончилось — у ноды новые версии и, возможно, новый ключ или статус.
  const state = q.data?.updates[0]?.state;
  const prev = React.useRef(state);
  React.useEffect(() => {
    if (prev.current && isActive({ state: prev.current }) && state && !isActive({ state })) {
      void qc.invalidateQueries({ queryKey: qk.node(nodeId) });
      void qc.invalidateQueries({ queryKey: qk.runtime(nodeId) });
    }
    prev.current = state;
  }, [state, nodeId, qc]);

  const cancel = useMutation({
    mutationFn: (uid: string) => api.nodes.cancelUpdate(nodeId, uid),
    onSuccess: () => {
      toast.success(t("updates.progress.cancelled"));
      void qc.invalidateQueries({ queryKey: qk.updates(nodeId) });
    },
    onError: (e) => {
      toast.error(errorMessage(e, t));
      void qc.invalidateQueries({ queryKey: qk.updates(nodeId) });
    },
  });

  if (!update) return null;
  const meta = updateStateMeta(update.state);
  const tone = TONE_CLASSES[meta.tone];
  const Icon = meta.icon;
  const at = update.finished_at ?? update.started_at ?? update.created_at;

  return (
    <section
      role="status"
      aria-live="polite"
      aria-label={t("updates.progress.label")}
      data-state={update.state}
      className={cn("rounded-lg border", tone.border, tone.bg)}
    >
      <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-start">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-1 ring-1 ring-line-strong",
            tone.text,
          )}
          aria-hidden
        >
          <Icon className={cn("size-4", meta.spinning && "animate-spin")} strokeWidth={2.25} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-semibold text-fg">
              {t(`updates.state.${update.state}`)} · {target(update)}
            </p>
            <p className="text-sm text-fg-muted" title={formatDateTime(at, i18n.language)}>
              {t(`updates.progress.text.${update.state}`, {
                step: update.step ? t(`updates.steps.${update.step}`) : "",
              })}{" "}
              <span className="text-fg-subtle">
                {t("updates.progress.meta", {
                  user: update.created_by ?? "—",
                  ago: formatRelative(at, i18n.language, now),
                })}
              </span>
            </p>
          </div>
          <UpdateSteps update={update} />
          {canAdmin && update.state === "pending" && (
            <p className="text-xs text-fg-subtle">{t("updates.progress.cancelHint")}</p>
          )}
          {isProblem(update.state) && update.error && (
            <pre className="max-h-40 overflow-auto rounded-md border border-fail/30 bg-surface-1 px-2.5 py-1.5 font-mono text-xs whitespace-pre-wrap [overflow-wrap:anywhere] text-fg">
              {update.error}
            </pre>
          )}
        </div>
        {canAdmin && update.state === "pending" && (
          <Button
            variant="outline"
            size="sm"
            disabled={cancel.isPending}
            title={t("updates.progress.cancelHint")}
            onClick={() => cancel.mutate(update.id)}
          >
            {cancel.isPending ? <LoaderCircle className="animate-spin" /> : <Ban />}
            {t("updates.progress.cancel")}
          </Button>
        )}
      </div>
    </section>
  );
}
