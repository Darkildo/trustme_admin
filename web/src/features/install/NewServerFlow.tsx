import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { DialogBody, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast-store";
import { Stepper } from "@/features/nodes/Stepper";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { qk } from "@/lib/queries";
import type { ProvisionResult } from "@/lib/types";
import { InstallPanel } from "./InstallPanel";
import { ProvisionForm } from "./ProvisionForm";
import { EMPTY_PROVISION, provisionPayload, type ProvisionFormValues } from "./validation";

type Step = 1 | 2 | 3;

/** «Поставить на новый сервер»: server form → install (command or SSH) → agent enrolled. */
export function NewServerFlow({
  onCreated,
  onClose,
  onOpenNode,
}: {
  onCreated: (id: string) => void;
  onClose: () => void;
  onOpenNode: (id: string) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [step, setStep] = React.useState<Step>(1);
  const [values, setValues] = React.useState<ProvisionFormValues>(EMPTY_PROVISION);
  const [result, setResult] = React.useState<ProvisionResult | null>(null);

  const provision = useMutation({
    mutationFn: () => api.nodes.provision(provisionPayload(values)),
    onSuccess: (res) => {
      setResult(res);
      setStep(2);
      onCreated(res.node_id);
      void qc.invalidateQueries({ queryKey: qk.nodes });
      void qc.invalidateQueries({ queryKey: qk.overview });
      void qc.invalidateQueries({ queryKey: qk.profiles });
      void qc.invalidateQueries({ queryKey: qk.turn });
      toast.success(t("install.created", { name: values.name.trim() }));
    },
  });

  const onInstalled = React.useCallback(() => setStep(3), []);

  return (
    <>
      <div className="px-5 pt-3">
        <Stepper
          current={step}
          steps={[t("install.steps.server"), t("install.steps.install"), t("install.steps.done")]}
        />
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step === 1 ? "form" : "install"}
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -12 }}
          transition={{ duration: 0.18 }}
          className="flex min-h-0 flex-1 flex-col"
        >
          {step === 1 || !result ? (
            <ProvisionForm
              values={values}
              onChange={setValues}
              onSubmit={() => provision.mutate()}
              onCancel={onClose}
              pending={provision.isPending}
              serverError={provision.error ? errorMessage(provision.error, t) : null}
            />
          ) : (
            <>
              <DialogBody className="flex flex-col gap-4">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-fg">{values.name.trim()}</span>
                  <span className="font-mono text-xs text-fg-muted">
                    {values.public_host.trim()}:{values.port}
                  </span>
                </div>
                <InstallPanel
                  nodeId={result.node_id}
                  publicHost={values.public_host.trim()}
                  withTurn={values.with_turn}
                  initialEnroll={result.enroll}
                  onInstalled={onInstalled}
                  onOpenNode={() => onOpenNode(result.node_id)}
                />
              </DialogBody>
              <DialogFooter>
                <Button variant={step === 3 ? "secondary" : "ghost"} onClick={onClose}>
                  {t("common.close")}
                </Button>
              </DialogFooter>
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </>
  );
}
