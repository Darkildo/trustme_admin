import { Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import { Hourglass } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Sparkline } from "@/components/Sparkline";
import { StatusIcon } from "@/components/StatusBadge";
import { formatMs, formatPercent } from "@/lib/format";
import { nodeStatusMeta, nodeStatusRank } from "@/lib/status";
import { TONE_CLASSES } from "@/lib/tone";
import type { OverviewTile } from "@/lib/types";
import { cn } from "@/lib/utils";

export function Tiles({
  tiles,
  provisioning,
}: {
  tiles: OverviewTile[];
  /** Ids of nodes awaiting installation. */
  provisioning?: ReadonlySet<string>;
}) {
  const { t } = useTranslation();
  const sorted = [...tiles].sort(
    (a, b) => nodeStatusRank(b.status) - nodeStatusRank(a.status) || a.name.localeCompare(b.name),
  );
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
      {sorted.map((tile, i) => {
        const waiting = provisioning?.has(tile.id) ?? false;
        const tone = nodeStatusMeta(tile.status).tone;
        return (
          <motion.li
            key={tile.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i * 0.035, 0.3), duration: 0.25 }}
          >
            <Link
              to="/nodes/$id"
              params={{ id: tile.id }}
              aria-label={t("nodes.open", { name: tile.name })}
              className="group relative flex h-full flex-col gap-3 overflow-hidden rounded-lg border border-line bg-surface-1 p-4 shadow-sm transition-[border-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-md"
            >
              <span
                aria-hidden
                className={cn(
                  "absolute inset-x-0 top-0 h-0.5 opacity-80",
                  waiting ? "bg-accent-2" : TONE_CLASSES[tone].fill,
                )}
              />
              {tile.status === "fail" && (
                <span
                  aria-hidden
                  className="absolute -top-10 -right-10 size-28 rounded-full bg-fail opacity-15 blur-2xl"
                />
              )}
              <div className="flex items-start justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  {waiting ? (
                    <Hourglass
                      role="img"
                      aria-label={t("status.provisioning")}
                      className="size-4 shrink-0 text-accent-2"
                      strokeWidth={2.25}
                    />
                  ) : (
                    <StatusIcon status={tile.status} />
                  )}
                  <span className="truncate font-medium text-fg">{tile.name}</span>
                </span>
                <span className="shrink-0 font-mono text-sm text-fg tabular">
                  {formatMs(tile.handshake_ms)}
                </span>
              </div>
              {waiting ? (
                <p className="flex h-8 items-end text-xs text-accent-2">
                  {t("status.provisioning")}
                </p>
              ) : (
                <div className="flex items-end gap-3">
                  <Sparkline
                    values={tile.spark}
                    label={`${t("nodes.uptime")}: ${formatPercent(tile.uptime_24h)}`}
                  />
                  <span className="shrink-0 text-right">
                    <span className="block font-mono text-xs text-fg tabular">
                      {formatPercent(tile.uptime_24h)}
                    </span>
                    <span className="block text-[11px] text-fg-subtle">
                      {t("overview.uptime24")}
                    </span>
                  </span>
                </div>
              )}
            </Link>
          </motion.li>
        );
      })}
    </ul>
  );
}
