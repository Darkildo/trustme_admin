import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "@/components/ui/toast-store";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { formatMs } from "@/lib/format";
import { qk } from "@/lib/queries";

/** «Проверить сейчас»: POST /nodes/{id}/probe, toast with the outcome, refresh caches. */
export function useProbeNow() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; name: string }) => api.nodes.probe(id),
    onSuccess: (probe, { name }) => {
      if (probe.ok) {
        toast.success(`${name}: ${t("node.probeOk", { ms: formatMs(probe.handshake_ms) })}`);
      } else {
        toast.error(
          `${name}: ${t("node.probeFail", {
            stage: probe.stage ? t(`node.stages.${probe.stage}`) : "—",
          })}`,
          probe.error ?? undefined,
        );
      }
    },
    onError: (e) => toast.error(errorMessage(e, t)),
    onSettled: (_d, _e, { id }) => {
      void qc.invalidateQueries({ queryKey: qk.node(id) });
      void qc.invalidateQueries({ queryKey: qk.nodes, exact: true });
      void qc.invalidateQueries({ queryKey: qk.overview });
    },
  });
}
