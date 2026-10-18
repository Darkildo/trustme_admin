import { BarChart, LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

echarts.use([
  LineChart,
  BarChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  CanvasRenderer,
]);

type EChartsOption = echarts.EChartsCoreOption;

export interface EChartProps {
  option: EChartsOption;
  className?: string;
  ariaLabel: string;
}

/** Thin React wrapper over echarts/core with resize handling. */
export default function EChartImpl({ option, className, ariaLabel }: EChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = echarts.init(el, undefined, { renderer: "canvas" });
    chartRef.current = chart;
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    chartRef.current?.setOption({ ...option, ...(reduce ? { animation: false } : {}) }, true);
  }, [option]);

  return (
    <div ref={ref} role="img" aria-label={ariaLabel} className={cn("h-56 w-full", className)} />
  );
}
