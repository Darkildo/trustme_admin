import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CircleCheck,
  Clock,
  KeyRound,
  PhoneCall,
  RefreshCw,
  Terminal,
  TerminalSquare,
  TriangleAlert,
} from "lucide-react";
import { motion } from "motion/react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { CodeBlock } from "@/components/CodeBlock";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { toast } from "@/components/ui/toast-store";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { nodeQuery, qk } from "@/lib/queries";
import type { EnrollInfo, NodeDetail } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { JobLog } from "./JobLog";
import { SshInstallForm } from "./SshInstallForm";
import { formatLeft } from "./time";
import { COTURN_PORTS, emptySshForm, sshPayload, type SshFormValues } from "./validation";

/** How often the panel asks whether the agent has enrolled. */
export const WAIT_POLL_MS = 3_000;

type Method = "command" | "ssh";

function CommandView({
  enroll,
  withTurn,
  pending,
  onIssue,
}: {
  enroll: EnrollInfo | null;
  withTurn: boolean;
  pending: boolean;
  onIssue: () => void;
}) {
  const { t } = useTranslation();
  const now = useNow(5_000) / 1000;
  const [confirm, setConfirm] = React.useState(false);
  const left = enroll ? enroll.expires_at - now : 0;
  const live = enroll !== null && left > 0;

  return (
    <div className="flex flex-col gap-3.5">
      <p className="text-sm text-fg-muted">{t("install.commandIntro")}</p>
      {withTurn && (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
          <PhoneCall className="size-3.5 text-accent" aria-hidden />
          {t("install.commandTurn")}:
          {COTURN_PORTS.map((p) => (
            <code
              key={p}
              className="rounded-xs border border-line bg-surface-2 px-1.5 font-mono text-[11px] text-fg"
            >
              {p}
            </code>
          ))}
        </p>
      )}
      {live ? (
        <CodeBlock code={enroll.command} label={t("install.command")} />
      ) : (
        <div className="flex items-start gap-2.5 rounded-md border border-dashed border-line-strong bg-bg-elevated px-3 py-3 text-sm text-fg-muted">
          <KeyRound className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
          {enroll ? t("install.expired") : t("install.noCommand")}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {live ? (
          <span className="flex items-center gap-1.5 text-xs text-fg-subtle tabular">
            <Clock className="size-3.5" aria-hidden />
            {t("install.expiresIn", { left: formatLeft(left, t) })}
          </span>
        ) : (
          <span />
        )}
        <Button
          variant={live ? "ghost" : "primary"}
          size="sm"
          disabled={pending}
          onClick={() => (live ? setConfirm(true) : onIssue())}
        >
          <RefreshCw className={pending ? "animate-spin" : undefined} />
          {pending ? t("install.reissuing") : t("install.reissue")}
        </Button>
      </div>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogTitle>{t("install.reissueTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("install.reissueText")}</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={onIssue}>{t("install.reissue")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** «Ждём агента»: radar animation while the node is still provisioning. */
function Waiting() {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      className="relative flex items-center gap-4 overflow-hidden rounded-lg border border-accent/25 bg-gradient-soft px-4 py-4"
    >
      <span className="relative flex size-11 shrink-0 items-center justify-center" aria-hidden>
        <span className="absolute inset-0 animate-pulse-ring rounded-full bg-accent/40" />
        <span className="absolute inset-1.5 animate-pulse-ring rounded-full bg-accent/30 [animation-delay:0.6s]" />
        <span className="relative flex size-8 items-center justify-center rounded-full bg-surface-1 ring-1 ring-accent/50">
          <Terminal className="size-4 text-accent" />
        </span>
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-sm font-medium text-fg">{t("install.waiting.title")}</p>
        <p className="text-xs text-fg-muted">{t("install.waiting.text")}</p>
        <p className="text-[11px] text-fg-subtle">{t("install.waiting.hint")}</p>
      </div>
    </div>
  );
}

function Done({ node, onOpenNode }: { node: NodeDetail; onOpenNode?: () => void }) {
  const { t } = useTranslation();
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      role="status"
      className="relative flex flex-col items-center gap-4 overflow-hidden rounded-xl border border-ok/30 bg-gradient-soft px-6 py-10 text-center"
    >
      <span
        aria-hidden
        className="absolute -top-16 size-56 rounded-full bg-ok opacity-15 blur-3xl"
      />
      <motion.span
        initial={{ scale: 0.4, rotate: -20 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 16, delay: 0.08 }}
        className="relative flex size-16 items-center justify-center rounded-full bg-gradient-brand shadow-glow"
        aria-hidden
      >
        <CircleCheck className="size-8 text-accent-fg" strokeWidth={2.25} />
      </motion.span>
      <div className="relative flex flex-col gap-1">
        <p className="text-lg font-semibold tracking-tight text-fg">{t("install.waiting.done")}</p>
        <p className="text-sm text-fg-muted">
          {t("install.waiting.doneText", { hostname: node.agent?.hostname ?? node.name })}
        </p>
        <p className="font-mono text-xs text-fg-subtle">{node.addr}</p>
      </div>
      {onOpenNode && (
        <Button variant="primary" onClick={onOpenNode} className="relative">
          {t("install.waiting.open")}
          <ArrowRight />
        </Button>
      )}
    </motion.div>
  );
}

/**
 * Install a provisioned node: one-line command or SSH, then wait for the agent to enroll
 * (the node stops being `provisioning`).
 */
export function InstallPanel({
  nodeId,
  publicHost,
  withTurn,
  initialEnroll,
  onInstalled,
  onOpenNode,
}: {
  nodeId: string;
  publicHost: string;
  withTurn: boolean;
  initialEnroll?: EnrollInfo | null;
  onInstalled?: () => void;
  onOpenNode?: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [method, setMethod] = React.useState<Method>("command");
  const [enroll, setEnroll] = React.useState<EnrollInfo | null>(initialEnroll ?? null);
  const [ssh, setSsh] = React.useState<SshFormValues>(() => emptySshForm(publicHost));
  const [jobId, setJobId] = React.useState<string | null>(null);
  const [sshDone, setSshDone] = React.useState(false);

  const node = useQuery({
    ...nodeQuery(nodeId),
    refetchInterval: (q) => (q.state.data && !q.state.data.provisioning ? false : WAIT_POLL_MS),
  });
  const installed = node.data !== undefined && !node.data.provisioning;
  const announced = React.useRef(false);
  React.useEffect(() => {
    if (installed && !announced.current) {
      announced.current = true;
      void qc.invalidateQueries({ queryKey: qk.nodes, exact: true });
      void qc.invalidateQueries({ queryKey: qk.overview });
      void qc.invalidateQueries({ queryKey: qk.turn });
      onInstalled?.();
    }
  }, [installed, onInstalled, qc]);

  const issue = useMutation({
    mutationFn: () => api.nodes.enrollToken(nodeId),
    onSuccess: (e) => {
      setEnroll(e);
      toast.success(t("install.reissued"));
    },
    onError: (e) => toast.error(errorMessage(e, t)),
  });

  const start = useMutation({
    mutationFn: (values: SshFormValues) => api.nodes.sshInstall(nodeId, sshPayload(values)),
    onSuccess: (id) => {
      setJobId(id);
      setSshDone(false);
      // The server issued a fresh enroll token for this run: the old command is dead.
      setEnroll(null);
      // Credentials are not kept around once used.
      setSsh((s) => ({ ...s, password: "", private_key: "", passphrase: "", sudo_password: "" }));
    },
  });

  const onJobSucceeded = React.useCallback(() => setSshDone(true), []);

  if (installed && node.data) {
    return <Done node={node.data} onOpenNode={onOpenNode} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-fg">{t("install.method")}</span>
        <Segmented<Method>
          value={method}
          onChange={setMethod}
          label={t("install.method")}
          options={[
            {
              value: "command",
              label: (
                <>
                  <Terminal aria-hidden />
                  {t("install.methodCommand")}
                </>
              ),
            },
            {
              value: "ssh",
              label: (
                <>
                  <TerminalSquare aria-hidden />
                  {t("install.methodSsh")}
                </>
              ),
            },
          ]}
        />
      </div>

      {method === "command" ? (
        <CommandView
          enroll={enroll}
          withTurn={withTurn}
          pending={issue.isPending}
          onIssue={() => issue.mutate()}
        />
      ) : jobId ? (
        <JobLog
          jobId={jobId}
          onSucceeded={onJobSucceeded}
          onRetry={() => {
            setJobId(null);
            setSshDone(false);
            start.reset();
          }}
        />
      ) : (
        <SshInstallForm
          values={ssh}
          onChange={setSsh}
          onSubmit={() => start.mutate(ssh)}
          pending={start.isPending}
          serverError={start.error ? errorMessage(start.error, t) : null}
          showReissueNote={enroll !== null}
        />
      )}

      {(method === "command" ? enroll !== null : sshDone) && <Waiting />}
      {node.isError && (
        <p className="flex items-center gap-2 text-xs text-warn">
          <TriangleAlert className="size-3.5" aria-hidden />
          {errorMessage(node.error, t)}
        </p>
      )}
    </div>
  );
}
