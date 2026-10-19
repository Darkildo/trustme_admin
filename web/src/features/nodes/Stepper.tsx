import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

/** Horizontal wizard steps: done ones get a check, the current one glows. `current` is 1-based. */
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  const { t } = useTranslation();
  return (
    <ol
      className="flex items-center gap-2"
      aria-label={t("wizard.step", { n: current, total: steps.length })}
    >
      {steps.map((label, i) => {
        const n = i + 1;
        const done = n < current;
        const active = n === current;
        return (
          <li
            key={label}
            className="flex min-w-0 flex-1 items-center gap-2"
            aria-current={active ? "step" : undefined}
          >
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] transition-colors",
                done && "border-accent bg-accent text-accent-fg",
                active && "border-accent text-accent shadow-glow",
                !done && !active && "border-line-strong text-fg-subtle",
              )}
            >
              {done ? <Check className="size-3.5" aria-hidden strokeWidth={3} /> : n}
            </span>
            <span
              className={cn("truncate text-xs font-medium", active ? "text-fg" : "text-fg-subtle")}
            >
              {label}
            </span>
            {i < steps.length - 1 && (
              <span
                className={cn("h-px min-w-3 flex-1", done ? "bg-accent/60" : "bg-line-strong")}
                aria-hidden
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
