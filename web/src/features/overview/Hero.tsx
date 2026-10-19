import { CircleCheck, CircleX, Hourglass, Plus, TriangleAlert, CircleHelp } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { useCan } from "@/app/useCurrentUser";
import { useUi } from "@/app/ui-context";
import { LiveDot } from "@/components/LiveDot";
import { Button } from "@/components/ui/button";
import { formatRelative } from "@/lib/format";
import type { Tone } from "@/lib/status";
import { TONE_CLASSES } from "@/lib/tone";
import type { Overview } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { cn } from "@/lib/utils";

export function Hero({
  data,
  updatedAt,
  provisioning = 0,
}: {
  data: Overview;
  updatedAt: number;
  /** Nodes awaiting installation (reported as `unknown` by the server). */
  provisioning?: number;
}) {
  const { t, i18n } = useTranslation();
  const canAdd = useCan("admin");
  const { openAddNode } = useUi();
  const now = useNow(5000);
  const s = data.nodes.by_status;
  const total = data.nodes.total;
  const ok = s.ok ?? 0;
  const attention = (s.warn ?? 0) + (s.stale ?? 0);
  const fail = s.fail ?? 0;
  const unknown = Math.max(0, (s.unknown ?? 0) - provisioning);
  const overall: Tone =
    fail > 0 ? "fail" : attention > 0 ? "warn" : unknown > 0 && ok === 0 ? "unknown" : "ok";
  const headline =
    fail > 0
      ? t("overview.someFailing")
      : attention > 0
        ? t("overview.someAttention")
        : t("overview.allGood");

  const parts: Array<{
    key: string;
    tone: Tone;
    icon: typeof CircleCheck;
    text: string;
    n: number;
  }> = [
    { key: "ok", tone: "ok", icon: CircleCheck, text: t("overview.ok", { count: ok }), n: ok },
    {
      key: "warn",
      tone: "warn",
      icon: TriangleAlert,
      text: t("overview.attention", { count: attention }),
      n: attention,
    },
    {
      key: "fail",
      tone: "fail",
      icon: CircleX,
      text: t("overview.fail", { count: fail }),
      n: fail,
    },
  ];
  if (unknown > 0)
    parts.push({
      key: "unknown",
      tone: "unknown",
      icon: CircleHelp,
      text: t("overview.unknown", { count: unknown }),
      n: unknown,
    });
  if (provisioning > 0)
    parts.push({
      key: "provisioning",
      tone: "unknown",
      icon: Hourglass,
      text: t("overview.provisioning", { count: provisioning }),
      n: provisioning,
    });

  return (
    <section
      aria-labelledby="hero-title"
      className="relative overflow-hidden rounded-xl border border-line-strong bg-surface-1 shadow-md"
    >
      <div aria-hidden className="absolute inset-0 bg-gradient-soft" />
      <div
        aria-hidden
        className="grid-bg absolute inset-0 [mask-image:radial-gradient(ellipse_at_top_right,black,transparent_70%)] opacity-60"
      />
      <div
        aria-hidden
        className={cn(
          "absolute -top-24 -right-24 size-72 rounded-full opacity-25 blur-3xl",
          TONE_CLASSES[overall].fill,
        )}
      />
      <div className="relative flex flex-col gap-6 p-5 sm:p-7 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex items-center gap-2.5 text-xs font-medium text-fg-muted">
            <LiveDot tone={overall} />
            <span className="tracking-wide uppercase">{t("common.live")}</span>
            <span aria-hidden className="text-fg-subtle">
              ·
            </span>
            <span className="tabular" title={t("overview.autoRefresh")}>
              {t("common.updated", {
                ago: formatRelative(updatedAt / 1000, i18n.language, now / 1000),
              })}
            </span>
          </div>
          <h1 id="hero-title" className="flex flex-col gap-1">
            <span className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
              <span className="text-gradient tabular">{t("overview.nodes", { count: total })}</span>
            </span>
            <span className="text-sm text-fg-muted sm:text-base">{headline}</span>
          </h1>
          <ul className="flex flex-wrap items-center gap-x-1 gap-y-2 text-sm">
            {parts.map((p, i) => {
              const Icon = p.icon;
              return (
                <li key={p.key} className="flex items-center gap-1">
                  {i > 0 && (
                    <span aria-hidden className="mx-1.5 hidden text-fg-subtle sm:inline">
                      ·
                    </span>
                  )}
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium tabular",
                      p.n > 0
                        ? [TONE_CLASSES[p.tone].text, TONE_CLASSES[p.tone].bg]
                        : "text-fg-subtle",
                    )}
                  >
                    <Icon className="size-3.5" aria-hidden strokeWidth={2.25} />
                    {p.text}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="flex w-full flex-col gap-3 lg:w-80">
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-3" aria-hidden>
            {(["ok", "unknown", "warn", "stale", "fail"] as const).map((k) => {
              const n = s[k] ?? 0;
              if (!n || !total) return null;
              return (
                <motion.span
                  key={k}
                  initial={{ width: 0 }}
                  animate={{ width: `${(n / total) * 100}%` }}
                  transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                  className={cn(
                    "h-full first:rounded-l-full last:rounded-r-full",
                    TONE_CLASSES[k].fill,
                  )}
                />
              );
            })}
          </div>
          {canAdd && (
            <Button variant="primary" className="self-start lg:self-end" onClick={openAddNode}>
              <Plus />
              {t("nodes.add")}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
