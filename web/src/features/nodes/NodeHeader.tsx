import type * as React from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Check,
  KeyRound,
  Pause,
  RefreshCw,
  ShieldCheck,
  Terminal,
  X,
  Zap,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useUi } from "@/app/ui-context";
import { useCan } from "@/app/useCurrentUser";
import { CopyButton } from "@/components/CopyButton";
import { AgentDot, NodeStatusBadge } from "@/components/NodeBadges";
import { PinChip } from "@/components/PinChip";
import { Button } from "@/components/ui/button";
import { UpdateAction, VersionChips } from "@/features/updates/NodeVersions";
import { formatBytes, formatDateTime, formatMs, formatRelative } from "@/lib/format";
import { nodeStatusMeta } from "@/lib/status";
import { TONE_CLASSES } from "@/lib/tone";
import type { NodeDetail } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { cn } from "@/lib/utils";
import { useProbeNow } from "./useProbeNow";

function Chip({ on, children, title }: { on: boolean; children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full border px-2.5 font-mono text-[11px]",
        on
          ? "border-accent/35 bg-accent-soft text-fg"
          : "border-line bg-surface-2 text-fg-subtle line-through decoration-fg-subtle/60",
      )}
    >
      {on ? (
        <Check className="size-3 text-accent" aria-hidden />
      ) : (
        <X className="size-3" aria-hidden />
      )}
      {children}
    </span>
  );
}

export function NodeHeader({ node }: { node: NodeDetail }) {
  const { t, i18n } = useTranslation();
  const canProbe = useCan("admin");
  const probe = useProbeNow();
  const { openInstall } = useUi();
  const now = useNow(15_000) / 1000;
  const cfg = node.last_probe?.config ?? null;
  const tone = node.provisioning ? "unknown" : nodeStatusMeta(node.status).tone;

  return (
    <header className="relative overflow-hidden rounded-xl border border-line-strong bg-surface-1 shadow-sm">
      <div
        aria-hidden
        className={cn("absolute inset-x-0 top-0 h-px opacity-80", TONE_CLASSES[tone].fill)}
      />
      <div
        aria-hidden
        className={cn(
          "absolute -top-20 -left-16 size-56 rounded-full opacity-[0.12] blur-3xl",
          TONE_CLASSES[tone].fill,
        )}
      />
      <div className="relative flex flex-col gap-4 p-4 sm:p-6">
        <Link
          to="/nodes"
          className="flex w-fit items-center gap-1.5 rounded-xs text-xs text-fg-subtle hover:text-fg"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          {t("node.backToList")}
        </Link>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-semibold tracking-tight text-fg">{node.name}</h1>
              <NodeStatusBadge node={node} />
              {node.paused && (
                <span className="inline-flex h-6 items-center gap-1 rounded-full border border-line-strong px-2.5 text-xs text-fg-muted">
                  <Pause className="size-3" aria-hidden />
                  {t("status.paused")}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex h-7 items-center gap-1 rounded-sm border border-line bg-surface-2 pr-0.5 pl-2.5 font-mono text-[13px] text-fg">
                {node.addr}
                <CopyButton
                  value={node.addr}
                  label={t("nodes.copyAddr")}
                  className="size-6"
                  toastTitle={t("common.copied")}
                  toastDescription={node.addr}
                />
              </span>
              {node.provisioning ? (
                <span className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-dashed border-line-strong px-2.5 text-xs text-fg-subtle">
                  <KeyRound className="size-3.5" aria-hidden />
                  {t("node.pinPending")}
                </span>
              ) : (
                <PinChip nodeKey={node.node_key} fingerprint={node.fingerprint} groups={4} />
              )}
              {node.agent && (
                <span className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-line bg-surface-2 pr-2.5 pl-1.5 font-mono text-xs text-fg-muted">
                  <AgentDot node={node} nowSec={now} />
                  {node.agent.hostname}
                </span>
              )}
            </div>
            <VersionChips node={node} />
            {cfg && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="inline-flex h-6 items-center gap-1 rounded-full bg-gradient-brand px-2.5 font-mono text-[11px] font-semibold text-accent-fg">
                  <ShieldCheck className="size-3" aria-hidden />
                  {t("node.proto", { version: cfg.proto_version })}
                </span>
                <Chip on={cfg.supports_delivery_ack}>{t("node.capDeliveryAck")}</Chip>
                <Chip on={cfg.supports_queue_addressing}>{t("node.capQueueAddressing")}</Chip>
                <Chip on={cfg.supports_blobs}>
                  {cfg.supports_blobs
                    ? t("node.capBlobs", { size: formatBytes(cfg.blob_max_size) })
                    : "blobs"}
                </Chip>
                <span className="text-[11px] text-fg-subtle">
                  {t("node.configExpires", { date: formatDateTime(cfg.expires_at, i18n.language) })}
                </span>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2 lg:items-end">
            <div className="flex flex-wrap gap-2 lg:justify-end">
              {canProbe && node.provisioning && (
                <Button
                  variant="primary"
                  onClick={() => openInstall({ id: node.id, name: node.name, addr: node.addr })}
                >
                  <Terminal />
                  {t("node.install")}
                </Button>
              )}
              {canProbe && !node.provisioning && (
                <Button
                  variant="primary"
                  disabled={probe.isPending}
                  onClick={() => probe.mutate({ id: node.id, name: node.name })}
                >
                  {probe.isPending ? <RefreshCw className="animate-spin" /> : <Zap />}
                  {probe.isPending ? t("node.probing") : t("node.probeNow")}
                </Button>
              )}
              {!node.provisioning && <UpdateAction node={node} />}
            </div>
            <p className="text-xs text-fg-subtle tabular">
              {node.last_probe
                ? `${t("node.lastProbeAgo", { ago: formatRelative(node.last_probe.at, i18n.language, now) })} · ${t("checks.handshakeMs")} ${formatMs(node.last_probe.handshake_ms)}`
                : t("node.noProbe")}
            </p>
            {node.last_probe && !node.last_probe.ok && node.last_probe.error && (
              <p className="max-w-sm rounded-md border border-fail/30 bg-fail-soft px-2.5 py-1.5 font-mono text-[11px] break-words text-fg lg:text-right">
                {node.last_probe.stage && (
                  <span className="font-semibold text-fail">
                    {t(`node.stages.${node.last_probe.stage}`)}:{" "}
                  </span>
                )}
                {node.last_probe.error}
              </p>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
