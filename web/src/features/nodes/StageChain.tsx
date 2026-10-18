import { Check, ChevronRight, LoaderCircle, Minus, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import type { Probe } from "@/lib/types";
import { cn } from "@/lib/utils";
import { deriveStages, type StageKey, type StageState, type StageView } from "./stages";

const LABEL_KEYS: Record<StageKey, string> = {
  tcp: "node.stages.connect",
  handshake: "node.stages.handshake",
  config: "node.stages.config",
};

/** Animated stage chain; reveals results stage by stage once the probe lands. */
export function StageChain({ probe, running }: { probe: Probe | null; running: boolean }) {
  return <StageList key={probe?.id ?? "none"} probe={probe} running={running} />;
}

function StageList({ probe, running }: { probe: Probe | null; running: boolean }) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const stages: StageView[] = deriveStages(probe);
  const [revealed, setRevealed] = React.useState(() => (probe && !reduce ? 0 : 3));
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    if (!probe || reduce) return;
    let i = 0;
    const id = window.setInterval(() => {
      i++;
      setRevealed(i);
      if (i >= 3) window.clearInterval(id);
    }, 380);
    return () => window.clearInterval(id);
  }, [probe, reduce]);

  React.useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setTick((x) => (x + 1) % 3), 650);
    return () => window.clearInterval(id);
  }, [running]);

  return (
    <ol
      className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center"
      aria-live="polite"
    >
      {stages.map((s, i) => {
        let state: StageState = s.state;
        if (running) state = i === tick ? "running" : i < tick ? "running" : "pending";
        else if (probe && i >= revealed) state = i === revealed ? "running" : "pending";
        const Icon =
          state === "ok"
            ? Check
            : state === "fail"
              ? X
              : state === "skipped"
                ? Minus
                : state === "running"
                  ? LoaderCircle
                  : null;
        return (
          <React.Fragment key={s.key}>
            {i > 0 && (
              <ChevronRight
                aria-hidden
                className={cn(
                  "hidden size-4 shrink-0 transition-colors sm:block",
                  state === "ok" || state === "fail" ? "text-fg-muted" : "text-line-strong",
                )}
              />
            )}
            <motion.li
              layout
              data-state={state}
              className={cn(
                "flex flex-1 items-center gap-3 rounded-lg border px-3.5 py-3 transition-colors duration-300",
                state === "ok" && "border-ok/35 bg-ok-soft",
                state === "fail" && "border-fail/40 bg-fail-soft",
                state === "running" && "border-accent/40 bg-accent-soft",
                (state === "pending" || state === "skipped") && "border-line bg-surface-2",
              )}
            >
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full",
                  state === "ok" && "bg-ok text-fg-inverse",
                  state === "fail" && "bg-fail text-fg-inverse",
                  state === "running" && "text-accent",
                  (state === "pending" || state === "skipped") && "bg-surface-3 text-fg-subtle",
                )}
              >
                {Icon ? (
                  <Icon
                    className={cn("size-4", state === "running" && "animate-spin")}
                    aria-hidden
                    strokeWidth={2.5}
                  />
                ) : (
                  <span className="font-mono text-xs">{i + 1}</span>
                )}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-medium text-fg first-letter:uppercase">
                  {t(LABEL_KEYS[s.key])}
                </span>
                <span className="font-mono text-xs text-fg-muted tabular">
                  {state === "ok" || state === "fail"
                    ? (s.detail ?? (state === "fail" ? "✕" : "✓"))
                    : "…"}
                </span>
              </span>
            </motion.li>
          </React.Fragment>
        );
      })}
    </ol>
  );
}
