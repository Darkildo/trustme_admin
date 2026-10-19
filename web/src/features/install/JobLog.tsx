import { useQuery } from "@tanstack/react-query";
import { CircleCheck, CircleX, LoaderCircle, RotateCcw, Terminal } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { isApiError } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { jobQuery } from "@/lib/queries";
import { TONE_CLASSES } from "@/lib/tone";
import type { JobStatus } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { cn } from "@/lib/utils";

const STATUS: Record<JobStatus, { tone: "stale" | "ok" | "fail"; icon: typeof CircleCheck }> = {
  running: { tone: "stale", icon: LoaderCircle },
  succeeded: { tone: "ok", icon: CircleCheck },
  failed: { tone: "fail", icon: CircleX },
};

function JobStatusPill({ status }: { status: JobStatus }) {
  const { t } = useTranslation();
  const meta = STATUS[status];
  const Icon = meta.icon;
  const tone = TONE_CLASSES[meta.tone];
  return (
    <span
      data-status={status}
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap",
        tone.text,
        tone.bg,
        tone.border,
      )}
    >
      <Icon
        className={cn("size-3.5", status === "running" && "animate-spin")}
        aria-hidden
        strokeWidth={2.25}
      />
      {t(`install.job.${status}`)}
    </span>
  );
}

/** Terminal-like live output of an SSH install job (`GET /jobs/{id}` every 1.5 s). */
export function JobLog({
  jobId,
  onSucceeded,
  onRetry,
}: {
  jobId: string;
  onSucceeded: () => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const q = useQuery(jobQuery(jobId));
  const job = q.data;
  const now = useNow(1000) / 1000;
  const scroller = React.useRef<HTMLPreElement>(null);
  const [stick, setStick] = React.useState(true);
  const notified = React.useRef(false);

  React.useEffect(() => {
    const el = scroller.current;
    if (el && stick) el.scrollTop = el.scrollHeight;
  }, [job?.output, stick]);

  React.useEffect(() => {
    if (job?.status === "succeeded" && !notified.current) {
      notified.current = true;
      onSucceeded();
    }
  }, [job?.status, onSucceeded]);

  const lost = q.isError && isApiError(q.error, "not_found");
  const elapsed = job ? Math.max(0, (job.finished_at ?? now) - job.started_at) : 0;
  const failed = job?.status === "failed" || q.isError;

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-lg border border-line-strong bg-bg shadow-sm">
        <div className="flex items-center gap-2 border-b border-line bg-surface-1 px-3 py-1.5">
          <span className="hidden gap-1 sm:flex" aria-hidden>
            <span className="size-2.5 rounded-full bg-fail/70" />
            <span className="size-2.5 rounded-full bg-warn/70" />
            <span className="size-2.5 rounded-full bg-ok/70" />
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-fg-subtle">
            <Terminal className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{t("install.job.title")}</span>
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-2">
            {job && (
              <span className="font-mono text-[11px] whitespace-nowrap text-fg-subtle tabular">
                {Math.round(elapsed)} {t("limits.units.s")}
              </span>
            )}
            {job ? (
              <JobStatusPill status={job.status} />
            ) : (
              !q.isError && <JobStatusPill status="running" />
            )}
          </span>
        </div>
        <pre
          ref={scroller}
          role="log"
          aria-live="polite"
          aria-label={t("install.job.log")}
          tabIndex={0}
          onScroll={(e) => {
            const el = e.currentTarget;
            setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
          }}
          className="h-64 overflow-auto px-3.5 py-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] text-fg-muted sm:h-72"
        >
          {job?.output ? (
            job.output
              .replace(/\n$/, "")
              .split("\n")
              .map((line, i) => (
                <span
                  key={i}
                  className={cn(
                    "block",
                    line.startsWith("==>") && "text-fg",
                    line.startsWith("$") && "text-accent",
                    /^(E:|error|ошибка)/i.test(line) && "text-fail",
                    /^host key/i.test(line) && "text-accent-2",
                  )}
                >
                  {line || " "}
                </span>
              ))
          ) : (
            <span className="text-fg-subtle">{t("install.job.waitingOutput")}</span>
          )}
          {job?.status === "running" && (
            <span
              aria-hidden
              className="inline-block h-3.5 w-1.5 animate-pulse bg-accent align-middle"
            />
          )}
        </pre>
      </div>

      {failed && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-md border border-fail/30 bg-fail-soft px-3 py-2.5 text-sm text-fg sm:flex-row sm:items-center"
        >
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            {lost ? (
              <span>{t("install.job.lost")}</span>
            ) : q.isError ? (
              <span>{errorMessage(q.error, t)}</span>
            ) : (
              <>
                {job?.error && <code className="font-mono text-xs break-words">{job.error}</code>}
                {job?.exit_code !== null && job?.exit_code !== undefined && (
                  <span className="font-mono text-xs text-fg-muted">
                    {t("install.job.exitCode", { code: job.exit_code })}
                  </span>
                )}
              </>
            )}
          </span>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            <RotateCcw />
            {t("install.job.again")}
          </Button>
        </div>
      )}
    </div>
  );
}
