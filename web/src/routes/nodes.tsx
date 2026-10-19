import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  FilterX,
  Hourglass,
  KeyRound,
  Pause,
  Plus,
  Search,
  Server,
  Terminal,
} from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useUi } from "@/app/ui-context";
import { useCan } from "@/app/useCurrentUser";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { AgentDot, NodeStatusBadge } from "@/components/NodeBadges";
import { PinChip } from "@/components/PinChip";
import { CheckStatusIcon } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  allLabels,
  filterNodes,
  listStatus,
  sortNodes,
  type ListStatus,
  type SortDir,
  type SortKey,
} from "@/features/nodes/list";
import { formatMs, formatPercent, formatRelative } from "@/lib/format";
import { nodesQuery } from "@/lib/queries";
import { NODE_STATUS_ORDER, nodeStatusMeta } from "@/lib/status";
import { TONE_CLASSES } from "@/lib/tone";
import type { NodeListItem } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { cn } from "@/lib/utils";

const ALL = "__all__";

function Labels({ labels }: { labels: Record<string, string> }) {
  const entries = Object.entries(labels);
  if (entries.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {entries.map(([k, v]) => (
        <span
          key={k}
          className="inline-flex h-5 items-center rounded-xs border border-line bg-surface-2 px-1.5 font-mono text-[11px] text-fg-muted"
        >
          {k}=<span className="text-fg">{v}</span>
        </span>
      ))}
    </span>
  );
}

function UptimeBar({ value }: { value: number | null }) {
  const tone = value === null ? "unknown" : value >= 0.99 ? "ok" : value >= 0.9 ? "warn" : "fail";
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-surface-3" aria-hidden>
        <span
          className={cn("block h-full rounded-full", TONE_CLASSES[tone].fill)}
          style={{ width: `${Math.round((value ?? 0) * 100)}%` }}
        />
      </span>
      <span className="font-mono text-xs text-fg tabular">{formatPercent(value)}</span>
    </span>
  );
}

function PinCell({ node }: { node: NodeListItem }) {
  const { t } = useTranslation();
  if (node.provisioning)
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-fg-subtle">
        <KeyRound className="size-3.5" aria-hidden />
        {t("node.pinPending")}
      </span>
    );
  return <PinChip nodeKey={node.node_key} fingerprint={node.fingerprint} />;
}

function ReportCell({ node, now }: { node: NodeListItem; now: number }) {
  const { t, i18n } = useTranslation();
  const canAdmin = useCan("admin");
  const { openInstall } = useUi();
  if (node.provisioning && canAdmin)
    return (
      <Button
        variant="secondary"
        size="sm"
        className="relative z-10 h-7"
        onClick={(e) => {
          e.stopPropagation();
          openInstall({ id: node.id, name: node.name, addr: node.addr });
        }}
      >
        <Terminal />
        {t("node.install")}
      </Button>
    );
  if (!node.last_report)
    return <span className="text-xs text-fg-subtle">{t("nodes.noReport")}</span>;
  return (
    <span className="flex items-center gap-1.5 text-xs text-fg-muted">
      <CheckStatusIcon status={node.last_report.status} className="size-3.5" />
      <span className="whitespace-nowrap tabular">
        {formatRelative(node.last_report.generated_at, i18n.language, now / 1000)}
      </span>
    </span>
  );
}

function SortHeader({
  label,
  k,
  sort,
  onSort,
  className,
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: SortDir };
  onSort: (k: SortKey) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const active = sort.key === k;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn("px-3 py-2.5 text-left font-medium", className)}
    >
      <button
        type="button"
        onClick={() => onSort(k)}
        aria-label={t("nodes.sortBy", { column: label })}
        className={cn(
          "inline-flex items-center gap-1 rounded-xs whitespace-nowrap transition-colors hover:text-fg",
          active ? "text-fg" : "text-fg-subtle",
        )}
      >
        {label}
        <Icon className="size-3" aria-hidden />
      </button>
    </th>
  );
}

export function NodesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const q = useQuery(nodesQuery);
  const canAdd = useCan("admin");
  const { openAddNode } = useUi();
  const now = useNow(30_000);

  const [text, setText] = React.useState("");
  const [statuses, setStatuses] = React.useState<ListStatus[]>([]);
  const [label, setLabel] = React.useState("");
  const [sort, setSort] = React.useState<{ key: SortKey; dir: SortDir }>({
    key: "status",
    dir: "desc",
  });

  const nodes = React.useMemo(() => q.data ?? [], [q.data]);
  const labels = React.useMemo(() => allLabels(nodes), [nodes]);
  const shown = React.useMemo(
    () => sortNodes(filterNodes(nodes, { text, statuses, label }), sort.key, sort.dir),
    [nodes, text, statuses, label, sort],
  );
  const filtered = text !== "" || statuses.length > 0 || label !== "";

  const onSort = (key: SortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "name" ? "asc" : "desc" },
    );
  const toggleStatus = (s: ListStatus) =>
    setStatuses((list) => (list.includes(s) ? list.filter((x) => x !== s) : [...list, s]));
  const clear = () => {
    setText("");
    setStatuses([]);
    setLabel("");
  };

  const addButton = canAdd && (
    <Button variant="primary" onClick={openAddNode}>
      <Plus />
      {t("nodes.add")}
    </Button>
  );

  const counts = React.useMemo(() => {
    const c: Record<ListStatus, number> = {
      ok: 0,
      unknown: 0,
      warn: 0,
      stale: 0,
      fail: 0,
      provisioning: 0,
    };
    for (const n of nodes) c[listStatus(n)]++;
    return c;
  }, [nodes]);
  const nowSec = now / 1000;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("nodes.title")} subtitle={t("nodes.subtitle")} actions={addButton} />

      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-10" />
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : nodes.length === 0 ? (
        <EmptyState
          icon={Server}
          title={t("nodes.emptyTitle")}
          text={t("nodes.emptyText")}
          action={addButton}
        />
      ) : (
        <>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative sm:w-80">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle"
                  aria-hidden
                />
                <Input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={t("nodes.filter")}
                  aria-label={t("nodes.filter")}
                  className="pl-9"
                />
              </div>
              {labels.length > 0 && (
                <Select value={label || ALL} onValueChange={(v) => setLabel(v === ALL ? "" : v)}>
                  <SelectTrigger className="sm:w-48" aria-label={t("nodes.label")}>
                    <SelectValue placeholder={t("nodes.allLabels")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>{t("nodes.allLabels")}</SelectItem>
                    {labels.map((l) => (
                      <SelectItem key={l} value={l} className="font-mono text-xs">
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <div className="flex items-center gap-2 sm:ml-auto">
                <span className="text-xs whitespace-nowrap text-fg-subtle tabular">
                  {t("nodes.shown", { shown: shown.length, total: nodes.length })}
                </span>
                {filtered && (
                  <Button variant="ghost" size="sm" onClick={clear}>
                    <FilterX />
                    {t("nodes.clearFilters")}
                  </Button>
                )}
              </div>
            </div>
            <div role="group" aria-label={t("nodes.status")} className="flex flex-wrap gap-1.5">
              {NODE_STATUS_ORDER.slice()
                .reverse()
                .map((s) => {
                  const meta = nodeStatusMeta(s);
                  const Icon = meta.icon;
                  const on = statuses.includes(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleStatus(s)}
                      className={cn(
                        "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
                        on
                          ? [
                              TONE_CLASSES[meta.tone].bg,
                              TONE_CLASSES[meta.tone].border,
                              TONE_CLASSES[meta.tone].text,
                            ]
                          : "border-line bg-surface-1 text-fg-muted hover:border-line-strong hover:text-fg",
                      )}
                    >
                      <Icon className={cn("size-3.5", TONE_CLASSES[meta.tone].text)} aria-hidden />
                      {t(meta.labelKey)}
                      <span className="font-mono tabular opacity-70">{counts[s]}</span>
                    </button>
                  );
                })}
              {counts.provisioning > 0 && (
                <button
                  type="button"
                  aria-pressed={statuses.includes("provisioning")}
                  onClick={() => toggleStatus("provisioning")}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
                    statuses.includes("provisioning")
                      ? "border-accent-2/40 bg-accent-2/10 text-accent-2"
                      : "border-line bg-surface-1 text-fg-muted hover:border-line-strong hover:text-fg",
                  )}
                >
                  <Hourglass className="size-3.5 text-accent-2" aria-hidden />
                  {t("status.provisioning")}
                  <span className="font-mono tabular opacity-70">{counts.provisioning}</span>
                </button>
              )}
            </div>
          </div>

          {shown.length === 0 ? (
            <EmptyState
              compact
              icon={FilterX}
              title={t("nodes.noMatchTitle")}
              text={t("nodes.noMatchText")}
              action={
                <Button variant="secondary" onClick={clear}>
                  {t("nodes.clearFilters")}
                </Button>
              }
            />
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden overflow-x-auto rounded-lg border border-line bg-surface-1 md:block">
                <table className="w-full text-sm">
                  <thead className="border-b border-line bg-bg-elevated text-xs">
                    <tr>
                      <SortHeader
                        label={t("nodes.status")}
                        k="status"
                        sort={sort}
                        onSort={onSort}
                        className="w-36 pl-4"
                      />
                      <SortHeader label={t("nodes.name")} k="name" sort={sort} onSort={onSort} />
                      <th scope="col" className="px-3 py-2.5 text-left font-medium text-fg-subtle">
                        {t("nodes.addr")}
                      </th>
                      <th scope="col" className="px-3 py-2.5 text-left font-medium text-fg-subtle">
                        {t("nodes.pin")}
                      </th>
                      <SortHeader
                        label={t("nodes.latency")}
                        k="latency"
                        sort={sort}
                        onSort={onSort}
                        className="text-right"
                      />
                      <SortHeader
                        label={t("nodes.uptime")}
                        k="uptime"
                        sort={sort}
                        onSort={onSort}
                      />
                      <SortHeader
                        label={t("nodes.report")}
                        k="report"
                        sort={sort}
                        onSort={onSort}
                        className="pr-4"
                      />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((n) => (
                      <tr
                        key={n.id}
                        onClick={() => void navigate({ to: "/nodes/$id", params: { id: n.id } })}
                        className="group cursor-pointer border-b border-line transition-colors last:border-0 hover:bg-surface-2"
                      >
                        <td className="py-3 pr-3 pl-4">
                          <span className="flex items-center gap-1.5">
                            <NodeStatusBadge node={n} size="sm" />
                            {n.paused && (
                              <Pause
                                className="size-3.5 text-fg-subtle"
                                role="img"
                                aria-label={t("status.paused")}
                              />
                            )}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex flex-col gap-1">
                            <span className="flex items-center gap-1.5">
                              <Link
                                to="/nodes/$id"
                                params={{ id: n.id }}
                                onClick={(e) => e.stopPropagation()}
                                className="w-fit font-medium text-fg group-hover:text-accent"
                              >
                                {n.name}
                              </Link>
                              <AgentDot node={n} nowSec={nowSec} />
                            </span>
                            <Labels labels={n.labels} />
                          </div>
                        </td>
                        <td className="px-3 py-3 font-mono text-[13px] whitespace-nowrap text-fg-muted">
                          {n.addr}
                        </td>
                        <td className="px-3 py-3">
                          <PinCell node={n} />
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-[13px] text-fg tabular">
                          {formatMs(n.last_probe?.handshake_ms)}
                        </td>
                        <td className="px-3 py-3">
                          <UptimeBar value={n.uptime_24h} />
                        </td>
                        <td className="py-3 pr-4 pl-3">
                          <ReportCell node={n} now={now} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <ul className="flex flex-col gap-2.5 md:hidden">
                {shown.map((n) => (
                  <li
                    key={n.id}
                    className="relative rounded-lg border border-line bg-surface-1 p-3.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="flex items-center gap-1.5">
                        <Link
                          to="/nodes/$id"
                          params={{ id: n.id }}
                          className="font-medium text-fg after:absolute after:inset-0 after:content-['']"
                        >
                          {n.name}
                        </Link>
                        <span className="relative z-10">
                          <AgentDot node={n} nowSec={nowSec} />
                        </span>
                      </span>
                      <NodeStatusBadge node={n} size="sm" />
                    </div>
                    <p className="mt-1 font-mono text-xs break-all text-fg-muted">{n.addr}</p>
                    <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
                      <span className="relative z-10">
                        <PinCell node={n} />
                      </span>
                      <span className="font-mono text-xs text-fg tabular">
                        {formatMs(n.last_probe?.handshake_ms)}
                      </span>
                      <UptimeBar value={n.uptime_24h} />
                    </div>
                    <div className="mt-2.5 flex items-center justify-between gap-2">
                      <Labels labels={n.labels} />
                      <ReportCell node={n} now={now} />
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
