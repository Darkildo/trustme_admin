import { useQuery } from "@tanstack/react-query";
import { ChevronRight, FileText } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AvailabilityStrip } from "@/components/AvailabilityStrip";
import { baseChartOption, useChartColors, withAlpha } from "@/components/chart-theme";
import { EChart, type EChartsOption } from "@/components/EChart";
import { ErrorState } from "@/components/ErrorState";
import { CheckStatusIcon } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime, formatRelative } from "@/lib/format";
import { probesQuery, reportsQuery, type HistoryRange } from "@/lib/queries";
import type { Probe } from "@/lib/types";
import { CountsBar } from "./CheckGroups";
import { ReportDialog } from "./ReportDialog";

function LatencyChart({ probes, range }: { probes: Probe[]; range: HistoryRange }) {
  const { t, i18n } = useTranslation();
  const c = useChartColors();
  const option = useMemo<EChartsOption>(() => {
    const connect = probes.map((p) => [p.at * 1000, p.connect_ms]);
    const handshake = probes.map((p) => [p.at * 1000, p.handshake_ms]);
    const fmt = new Intl.DateTimeFormat(
      i18n.language,
      range === "7d" ? { day: "2-digit", month: "short" } : { hour: "2-digit", minute: "2-digit" },
    );
    return {
      ...baseChartOption(c),
      legend: {
        top: 0,
        right: 0,
        icon: "roundRect",
        itemWidth: 10,
        itemHeight: 4,
        textStyle: { color: c.fgMuted, fontSize: 12 },
      },
      grid: { left: 8, right: 12, top: 32, bottom: 4, containLabel: true },
      xAxis: {
        type: "time",
        axisLine: { lineStyle: { color: c.grid } },
        axisTick: { show: false },
        axisLabel: {
          color: c.axis,
          fontSize: 11,
          formatter: (v: number) => fmt.format(new Date(v)),
          hideOverlap: true,
        },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value",
        splitLine: { lineStyle: { color: c.grid } },
        axisLabel: { color: c.axis, fontSize: 11, formatter: "{value} ms" },
      },
      series: [
        {
          name: t("history.handshake"),
          type: "line",
          showSymbol: false,
          sampling: "lttb",
          connectNulls: false,
          data: handshake,
          lineStyle: { width: 1.75, color: c.series1 },
          itemStyle: { color: c.series1 },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: withAlpha(c.series1, 0.25) },
                { offset: 1, color: withAlpha(c.series1, 0) },
              ],
            },
          },
        },
        {
          name: t("history.connect"),
          type: "line",
          showSymbol: false,
          sampling: "lttb",
          connectNulls: false,
          data: connect,
          lineStyle: { width: 1.5, color: c.series2 },
          itemStyle: { color: c.series2 },
        },
      ],
    };
  }, [c, probes, range, t, i18n.language]);
  return <EChart option={option} ariaLabel={t("history.latency")} className="h-64" />;
}

export function HistoryTab({ nodeId }: { nodeId: string }) {
  const { t, i18n } = useTranslation();
  const [range, setRange] = useState<HistoryRange>("24h");
  const [openReport, setOpenReport] = useState<string | null>(null);
  const [visible, setVisible] = useState(10);
  const probes = useQuery(probesQuery(nodeId, range));
  const reports = useQuery(reportsQuery(nodeId));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-fg-muted">{t("history.range")}</span>
        <Segmented
          label={t("history.range")}
          value={range}
          onChange={setRange}
          options={[
            { value: "1h", label: t("history.r1h") },
            { value: "24h", label: t("history.r24h") },
            { value: "7d", label: t("history.r7d") },
          ]}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("history.latency")}</CardTitle>
        </CardHeader>
        <CardContent>
          {probes.isPending ? (
            <Skeleton className="h-64" />
          ) : probes.isError ? (
            <ErrorState error={probes.error} onRetry={() => void probes.refetch()} />
          ) : probes.data.probes.length === 0 ? (
            <p className="py-16 text-center text-sm text-fg-subtle">{t("history.noProbes")}</p>
          ) : (
            <LatencyChart probes={probes.data.probes} range={range} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("history.availability")}</CardTitle>
        </CardHeader>
        <CardContent>
          {probes.isPending ? (
            <Skeleton className="h-8" />
          ) : probes.data && probes.data.probes.length > 0 ? (
            <AvailabilityStrip
              probes={probes.data.probes}
              since={probes.data.since}
              until={probes.data.until}
            />
          ) : (
            <p className="text-sm text-fg-subtle">{t("history.noProbes")}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("history.reports")}</CardTitle>
        </CardHeader>
        <CardContent className="px-0 sm:px-0">
          {reports.isPending ? (
            <div className="flex flex-col gap-2 px-4">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-11" />
              ))}
            </div>
          ) : reports.isError ? (
            <div className="px-4">
              <ErrorState error={reports.error} onRetry={() => void reports.refetch()} />
            </div>
          ) : reports.data.length === 0 ? (
            <p className="flex items-center gap-2 px-5 py-6 text-sm text-fg-subtle">
              <FileText className="size-4" aria-hidden />
              {t("history.noReports")}
            </p>
          ) : (
            <ul className="divide-y divide-line border-t border-line">
              {reports.data.slice(0, visible).map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setOpenReport(r.id)}
                    aria-label={t("history.openReport", {
                      date: formatDateTime(r.generated_at, i18n.language),
                    })}
                    className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 text-left transition-colors hover:bg-surface-2 sm:px-5"
                  >
                    <CheckStatusIcon status={r.status} />
                    <span className="font-mono text-[13px] text-fg tabular">
                      {formatDateTime(r.generated_at, i18n.language)}
                    </span>
                    <span className="text-xs text-fg-subtle">
                      {formatRelative(r.generated_at, i18n.language)}
                    </span>
                    <span className="hidden font-mono text-xs text-fg-subtle sm:inline">
                      tmnode {r.tmnode_version}
                    </span>
                    <span className="ml-auto flex items-center gap-2">
                      <CountsBar counts={r.counts} />
                      <ChevronRight className="size-4 text-fg-subtle" aria-hidden />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {reports.data && reports.data.length > visible && (
            <div className="flex justify-center border-t border-line pt-3">
              <Button variant="ghost" size="sm" onClick={() => setVisible((v) => v + 20)}>
                {t("common.loadMore")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <ReportDialog nodeId={nodeId} reportId={openReport} onClose={() => setOpenReport(null)} />
    </div>
  );
}
