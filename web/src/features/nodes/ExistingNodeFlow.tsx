import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, CircleCheck, CircleX, RefreshCw } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { CodeBlock } from "@/components/CodeBlock";
import { SecretOnce } from "@/components/SecretOnce";
import { Button } from "@/components/ui/button";
import { DialogBody, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast-store";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { qk } from "@/lib/queries";
import type { CreateNodeResult, Probe } from "@/lib/types";
import { buildCronCommand, panelOrigin } from "./cron";
import { NodeForm } from "./NodeForm";
import { StageChain } from "./StageChain";
import { Stepper } from "./Stepper";
import type { NodeFormValues } from "./validation";

type Step = 1 | 2 | 3;

const EMPTY: NodeFormValues = { name: "", addr: "", node_key: "", labels: "" };

/**
 * «Подключить существующую ноду»: address and pin → live probe → ingest token and cron line.
 */
export function ExistingNodeFlow({
  onCreated,
  onClose,
}: {
  onCreated: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [step, setStep] = React.useState<Step>(1);
  const [values, setValues] = React.useState<NodeFormValues>(EMPTY);
  const [created, setCreated] = React.useState<CreateNodeResult | null>(null);
  const [probe, setProbe] = React.useState<Probe | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.nodes });
    void qc.invalidateQueries({ queryKey: qk.overview });
  };

  const probeMut = useMutation({
    mutationFn: (id: string) => api.nodes.probe(id),
    onMutate: () => setProbe(null),
    onSuccess: (p) => {
      setProbe(p);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e, t)),
  });

  const createMut = useMutation({
    mutationFn: (input: Parameters<typeof api.nodes.create>[0]) => api.nodes.create(input),
    onSuccess: (res) => {
      setCreated(res);
      setStep(2);
      onCreated(res.node.id);
      refresh();
      toast.success(t("wizard.created", { name: res.node.name }));
      if (res.node.last_probe) setProbe(res.node.last_probe);
      else probeMut.mutate(res.node.id);
    },
  });

  const command = created ? buildCronCommand(created.ingest_token, panelOrigin()) : "";

  return (
    <>
      <div className="px-5 pt-3">
        <Stepper
          current={step}
          steps={[t("wizard.steps.address"), t("wizard.steps.check"), t("wizard.steps.reports")]}
        />
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -12 }}
          transition={{ duration: 0.18 }}
          className="flex min-h-0 flex-1 flex-col"
        >
          {step === 1 && (
            <NodeForm
              values={values}
              onChange={setValues}
              pending={createMut.isPending}
              serverError={createMut.error ? errorMessage(createMut.error, t) : null}
              submitLabel={createMut.isPending ? t("wizard.creating") : t("wizard.create")}
              onCancel={onClose}
              onSubmit={(input) => createMut.mutate(input)}
            />
          )}
          {step === 2 && created && (
            <>
              <DialogBody className="flex flex-col gap-5">
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-fg">{created.node.name}</span>
                  <span className="font-mono text-xs text-fg-muted">{created.node.addr}</span>
                </div>
                <StageChain probe={probe} running={probeMut.isPending} />
                <div aria-live="polite" className="min-h-12">
                  {probeMut.isPending || !probe ? (
                    <p className="text-sm text-fg-muted">{t("wizard.checking")}</p>
                  ) : probe.ok ? (
                    <p className="flex items-start gap-2 text-sm text-fg">
                      <CircleCheck className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
                      {t("wizard.checkOk")}
                    </p>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      <p className="flex items-start gap-2 text-sm text-fg">
                        <CircleX className="mt-0.5 size-4 shrink-0 text-fail" aria-hidden />
                        {t("wizard.checkFail", {
                          stage: probe.stage ? t(`node.stages.${probe.stage}`) : "—",
                        })}
                      </p>
                      {probe.error && (
                        <code className="rounded-md border border-fail/30 bg-fail-soft px-3 py-2 font-mono text-xs break-all text-fg">
                          {probe.error}
                        </code>
                      )}
                    </div>
                  )}
                </div>
              </DialogBody>
              <DialogFooter>
                <Button
                  variant="ghost"
                  disabled={probeMut.isPending}
                  onClick={() => probeMut.mutate(created.node.id)}
                >
                  <RefreshCw />
                  {t("wizard.retry")}
                </Button>
                <Button
                  variant={probe && !probe.ok ? "secondary" : "primary"}
                  disabled={probeMut.isPending}
                  onClick={() => setStep(3)}
                >
                  {probe && !probe.ok ? t("wizard.continueAnyway") : t("wizard.continue")}
                  <ArrowRight />
                </Button>
              </DialogFooter>
            </>
          )}
          {step === 3 && created && (
            <>
              <DialogBody className="flex flex-col gap-5">
                <p className="text-sm text-fg-muted">{t("connect.intro")}</p>
                <SecretOnce
                  label={t("wizard.tokenTitle")}
                  value={created.ingest_token}
                  warning={t("wizard.tokenWarning")}
                />
                <CodeBlock code={command} label={t("wizard.command")} />
              </DialogBody>
              <DialogFooter>
                <Button variant="primary" onClick={onClose}>
                  <Check />
                  {t("wizard.finish")}
                </Button>
              </DialogFooter>
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </>
  );
}
