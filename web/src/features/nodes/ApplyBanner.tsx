import { History, Power, Rocket, Terminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useUi } from "@/app/ui-context";
import { useCan } from "@/app/useCurrentUser";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatRelative } from "@/lib/format";
import { TONE_CLASSES } from "@/lib/tone";
import type { NodeDetail, NodeRuntime, Setting } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { cn } from "@/lib/utils";
import { applyBanner } from "./runtime";

/** What the agent did with the desired runtime.toml: no agent / applying / applied / rejected. */
export function ApplyBanner({
  node,
  runtime,
  catalog,
}: {
  node: NodeDetail;
  runtime: NodeRuntime;
  catalog: readonly Setting[];
}) {
  const { t, i18n } = useTranslation();
  const { openAddNode, openInstall } = useUi();
  const canAdmin = useCan("admin");
  const now = useNow(10_000) / 1000;
  const b = applyBanner(runtime);
  const tone = TONE_CLASSES[b.tone];
  const Icon = b.icon;
  const lastSeen = runtime.agent?.last_seen_at ?? null;
  const params = {
    version:
      b.variant === "applied" || b.variant === "invalid"
        ? (b.version ?? "—")
        : runtime.desired_version,
    ago:
      b.variant === "pending_offline"
        ? lastSeen
          ? formatRelative(lastSeen, i18n.language, now)
          : t("runtime.agent.never")
        : b.at
          ? formatRelative(b.at, i18n.language, now)
          : "—",
  };
  const summaries = new Map(catalog.map((s) => [s.key, s.summary]));
  const unsupported = runtime.unsupported ?? [];

  return (
    <section
      role="status"
      aria-live="polite"
      data-variant={b.variant}
      className={cn("relative overflow-hidden rounded-lg border", tone.border, tone.bg)}
    >
      <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-start">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-1 ring-1 ring-line-strong",
            tone.text,
          )}
          aria-hidden
        >
          <Icon className={cn("size-4", b.spinning && "animate-spin")} strokeWidth={2.25} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-sm font-semibold text-fg">{t(`runtime.banner.${b.variant}.title`)}</p>
          <p
            className="text-sm text-fg-muted"
            title={b.at ? formatDateTime(b.at, i18n.language) : undefined}
          >
            {t(`runtime.banner.${b.variant}.text`, params)}
          </p>
          {b.error && (
            <code className="mt-1 rounded-md border border-fail/30 bg-surface-1 px-2.5 py-1.5 font-mono text-xs break-words text-fg">
              {b.error}
            </code>
          )}
        </div>
        {canAdmin && b.variant === "manual" && (
          <Button variant="secondary" size="sm" onClick={openAddNode}>
            <Rocket />
            {t("runtime.newNode")}
          </Button>
        )}
        {canAdmin && b.variant === "not_installed" && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => openInstall({ id: node.id, name: node.name, addr: node.addr })}
          >
            <Terminal />
            {t("node.install")}
          </Button>
        )}
      </div>
      {b.pendingRestart.length > 0 && (
        <div className="border-t border-warn/25 bg-warn-soft px-4 py-3">
          <p className="flex items-center gap-2 text-[13px] font-medium text-fg">
            <Power className="size-3.5 text-warn" aria-hidden />
            {t("runtime.pendingRestart")}
            <span className="font-mono text-xs text-fg-subtle tabular">
              {b.pendingRestart.length}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-fg-muted">{t("runtime.pendingRestartHint")}</p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {b.pendingRestart.map((key) => (
              <li
                key={key}
                title={summaries.get(key)}
                className="inline-flex h-6 items-center rounded-sm border border-warn/30 bg-surface-1 px-2 font-mono text-[11px] text-fg"
              >
                {key}
              </li>
            ))}
          </ul>
        </div>
      )}
      {unsupported.length > 0 && (
        <div className="border-t border-line bg-surface-1/60 px-4 py-3">
          <p className="flex items-center gap-2 text-[13px] font-medium text-fg">
            <History className="size-3.5 text-fg-subtle" aria-hidden />
            {t("runtime.unsupported")}
            <span className="font-mono text-xs text-fg-subtle tabular">{unsupported.length}</span>
          </p>
          <p className="mt-0.5 text-xs text-fg-muted">{t("runtime.unsupportedHint")}</p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {unsupported.map((key) => (
              <li
                key={key}
                title={summaries.get(key)}
                className="inline-flex h-6 items-center rounded-sm border border-line bg-surface-1 px-2 font-mono text-[11px] text-fg"
              >
                {key}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
