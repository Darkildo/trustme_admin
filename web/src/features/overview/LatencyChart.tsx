import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { baseChartOption, useChartColors, withAlpha } from "@/components/chart-theme";
import { EChart, type EChartsOption } from "@/components/EChart";
import { formatTime } from "@/lib/format";
import type { Overview } from "@/lib/types";

export function LatencyChart({ points }: { points: Overview["latency"] }) {
  const { t, i18n } = useTranslation();
  const c = useChartColors();
  const option = useMemo<EChartsOption>(() => {
    const values = points.map((p) => p.handshake_ms_p50);
    // Час без соседей линией не нарисовать — такой точке нужен маркер,
    // иначе первый час работы парка на графике не виден.
    const isolated = values.map(
      (v, i) => v !== null && values[i - 1] == null && values[i + 1] == null,
    );
    return {
      ...baseChartOption(c),
      grid: { left: 8, right: 12, top: 16, bottom: 4, containLabel: true },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: points.map((p) => formatTime(p.at, i18n.language)),
        axisLine: { lineStyle: { color: c.grid } },
        axisTick: { show: false },
        axisLabel: { color: c.axis, fontSize: 11, interval: 3 },
      },
      yAxis: {
        type: "value",
        splitLine: { lineStyle: { color: c.grid } },
        axisLabel: { color: c.axis, fontSize: 11, formatter: "{value} ms" },
      },
      series: [
        {
          name: "p50",
          type: "line",
          smooth: true,
          showSymbol: true,
          symbol: "circle",
          symbolSize: (_value: unknown, params: { dataIndex: number }) =>
            isolated[params.dataIndex] ? 7 : 0,
          connectNulls: false,
          data: values,
          lineStyle: { width: 2, color: c.series1 },
          itemStyle: { color: c.series1 },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: withAlpha(c.series1, 0.33) },
                { offset: 1, color: withAlpha(c.series1, 0) },
              ],
            },
          },
        },
      ],
    };
  }, [c, points, i18n.language]);
  return <EChart option={option} ariaLabel={t("overview.latency")} className="h-60" />;
}
