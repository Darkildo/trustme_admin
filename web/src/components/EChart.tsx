import type { EChartsCoreOption } from "echarts/core";
import { lazy, Suspense } from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "./ui/skeleton";

export type EChartsOption = EChartsCoreOption;

// ECharts is the heaviest dependency; load it only on screens with charts.
const EChartImpl = lazy(() => import("./EChartImpl"));

export function EChart(props: { option: EChartsOption; className?: string; ariaLabel: string }) {
  return (
    <Suspense fallback={<Skeleton className={cn("h-56 w-full", props.className)} />}>
      <EChartImpl {...props} />
    </Suspense>
  );
}
