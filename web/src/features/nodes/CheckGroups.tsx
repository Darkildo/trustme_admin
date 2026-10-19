import {
  ChevronRight,
  Cog,
  Cpu,
  HardDrive,
  KeyRound,
  Lightbulb,
  Network,
  Box,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { CheckStatusIcon } from "@/components/StatusBadge";
import { checkStatusMeta } from "@/lib/status";
import { TONE_CLASSES } from "@/lib/tone";
import type { Check } from "@/lib/types";
import { cn } from "@/lib/utils";
import { groupChecks, type CheckGroupKey } from "./checks";

const GROUP_ICONS: Record<CheckGroupKey, LucideIcon> = {
  config: Cog,
  runtime: Cpu,
  identity: KeyRound,
  host: HardDrive,
  endpoint: Network,
  other: Box,
};

function CheckRow({ check }: { check: Check }) {
  const { t } = useTranslation();
  const hasData = check.data && Object.keys(check.data).length > 0;
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-start gap-3">
        <CheckStatusIcon status={check.status} className="mt-0.5" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm text-fg">{check.summary}</span>
          <span className="font-mono text-[11px] text-fg-subtle">{check.id}</span>
        </div>
      </div>
      {check.hint && (
        <div className="ml-7 flex items-start gap-2 rounded-md border border-accent/30 bg-accent-soft px-3 py-2">
          <Lightbulb className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
          <p className="text-[13px] text-fg">
            <span className="font-semibold text-accent">{t("checks.hint")}: </span>
            {check.hint}
          </p>
        </div>
      )}
      {hasData && (
        <details className="group ml-7">
          <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-xs text-xs text-fg-subtle hover:text-fg-muted [&::-webkit-details-marker]:hidden">
            <ChevronRight
              className="size-3 transition-transform group-open:rotate-90"
              aria-hidden
            />
            {t("checks.data")}
          </summary>
          <pre className="mt-1.5 overflow-x-auto rounded-md border border-line bg-bg px-3 py-2 font-mono text-[11.5px] text-fg-muted">
            {JSON.stringify(check.data, null, 2)}
          </pre>
        </details>
      )}
    </li>
  );
}

/** Report checks grouped by id prefix: Конфиг, Рантайм, Ключ, Ресурсы, Сеть (+ Прочее). */
export function CheckGroups({ checks }: { checks: Check[] }) {
  const { t } = useTranslation();
  const groups = groupChecks(checks);
  return (
    <div className="gap-4 lg:columns-2 [&>*]:mb-4 [&>*]:break-inside-avoid">
      {groups.map((g, i) => {
        const Icon = GROUP_ICONS[g.key];
        const tone = checkStatusMeta(g.worst).tone;
        const problems = g.checks.filter((c) => c.status !== "ok" && c.status !== "skip").length;
        return (
          <motion.section
            key={g.key}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            aria-labelledby={`group-${g.key}`}
            className={cn(
              "overflow-hidden rounded-lg border bg-surface-1",
              problems > 0 ? TONE_CLASSES[tone].border : "border-line",
            )}
          >
            <header className="flex items-center gap-2.5 border-b border-line bg-bg-elevated px-4 py-2.5">
              <span
                className={cn(
                  "flex size-7 items-center justify-center rounded-md",
                  TONE_CLASSES[tone].bg,
                )}
              >
                <Icon className={cn("size-4", TONE_CLASSES[tone].text)} aria-hidden />
              </span>
              <h3
                id={`group-${g.key}`}
                className="text-[13px] font-semibold tracking-wide text-fg-muted uppercase"
              >
                {t(`checks.groups.${g.key}`)}
              </h3>
              <span className="ml-auto flex items-center gap-1.5">
                <CheckStatusIcon status={g.worst} className="size-3.5" />
                <span className="font-mono text-xs text-fg-subtle tabular">
                  {g.checks.length - problems}/{g.checks.length}
                </span>
              </span>
            </header>
            <ul className="divide-y divide-line">
              {g.checks.map((c) => (
                <CheckRow key={c.id} check={c} />
              ))}
            </ul>
          </motion.section>
        );
      })}
    </div>
  );
}

export function CountsBar({
  counts,
}: {
  counts: { ok: number; skip: number; warn: number; error: number; fail: number };
}) {
  const { t } = useTranslation();
  const items = (["ok", "skip", "warn", "error", "fail"] as const).filter((k) => counts[k] > 0);
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((k) => {
        const meta = checkStatusMeta(k);
        const Icon = meta.icon;
        return (
          <li
            key={k}
            className={cn(
              "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium",
              TONE_CLASSES[meta.tone].text,
              TONE_CLASSES[meta.tone].bg,
              TONE_CLASSES[meta.tone].border,
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            <span className="font-mono tabular">{counts[k]}</span>
            <span>{t(meta.labelKey)}</span>
          </li>
        );
      })}
    </ul>
  );
}
