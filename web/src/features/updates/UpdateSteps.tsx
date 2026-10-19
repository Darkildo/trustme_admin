import { Check, LoaderCircle, Minus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { NodeUpdate } from "@/lib/types";
import { cn } from "@/lib/utils";
import { deriveSteps, type StepState } from "./updates";

/** Шаги задания агента по порядку: готово — галочка, текущий — спиннер, неудачный — крест. */
export function UpdateSteps({
  update,
}: {
  update: Pick<NodeUpdate, "node_version" | "tmnode_version" | "state" | "step">;
}) {
  const { t } = useTranslation();
  const steps = deriveSteps(update);
  return (
    <ol className="flex flex-wrap items-center gap-1.5" aria-label={t("updates.progress.steps")}>
      {steps.map((s, i) => (
        <li
          key={s.key}
          data-state={s.state}
          aria-current={s.state === "running" ? "step" : undefined}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-full border pr-2.5 pl-1 text-xs transition-colors",
            s.state === "done" && "border-ok/35 bg-ok-soft text-fg",
            s.state === "fail" && "border-fail/40 bg-fail-soft text-fg",
            s.state === "running" && "border-accent/40 bg-accent-soft text-fg",
            (s.state === "pending" || s.state === "skipped") &&
              "border-line bg-surface-2 text-fg-subtle",
            s.state === "skipped" && "line-through decoration-fg-subtle/60",
          )}
        >
          <StepIcon state={s.state} n={i + 1} />
          <span>{t(`updates.steps.${s.key}`)}</span>
          <span className="sr-only">· {t(`updates.stepState.${s.state}`)}</span>
        </li>
      ))}
    </ol>
  );
}

function StepIcon({ state, n }: { state: StepState; n: number }) {
  const base = "flex size-5 shrink-0 items-center justify-center rounded-full";
  switch (state) {
    case "done":
      return (
        <span className={cn(base, "bg-ok text-fg-inverse")} aria-hidden>
          <Check className="size-3" strokeWidth={3} />
        </span>
      );
    case "fail":
      return (
        <span className={cn(base, "bg-fail text-fg-inverse")} aria-hidden>
          <X className="size-3" strokeWidth={3} />
        </span>
      );
    case "running":
      return (
        <span className={cn(base, "text-accent")} aria-hidden>
          <LoaderCircle className="size-3.5 animate-spin" strokeWidth={2.5} />
        </span>
      );
    case "skipped":
      return (
        <span className={cn(base, "bg-surface-3 text-fg-subtle")} aria-hidden>
          <Minus className="size-3" />
        </span>
      );
    default:
      return (
        <span className={cn(base, "bg-surface-3 font-mono text-[10px] text-fg-subtle")} aria-hidden>
          {n}
        </span>
      );
  }
}
