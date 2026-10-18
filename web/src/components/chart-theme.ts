import type { EChartsCoreOption } from "echarts/core";
import { useMemo } from "react";
import { useTheme } from "@/lib/theme";

type EChartsOption = EChartsCoreOption;

export interface ChartColors {
  series1: string;
  series2: string;
  grid: string;
  axis: string;
  fg: string;
  fgMuted: string;
  surface: string;
  line: string;
  ok: string;
  fail: string;
  warn: string;
}

function readVar(style: CSSStyleDeclaration, name: string, fallback: string): string {
  const v = style.getPropertyValue(name).trim();
  return v || fallback;
}

/** Resolves chart colours from the CSS tokens of the active theme. */
export function useChartColors(): ChartColors {
  const theme = useTheme();
  return useMemo(() => {
    const s = getComputedStyle(document.documentElement);
    return {
      series1: readVar(s, "--tm-chart-1", "teal"),
      series2: readVar(s, "--tm-chart-2", "violet"),
      grid: readVar(s, "--tm-chart-grid", "gray"),
      axis: readVar(s, "--tm-chart-axis", "gray"),
      fg: readVar(s, "--tm-fg", "black"),
      fgMuted: readVar(s, "--tm-fg-muted", "gray"),
      surface: readVar(s, "--tm-surface-2", "white"),
      line: readVar(s, "--tm-line-strong", "gray"),
      ok: readVar(s, "--tm-ok", "green"),
      fail: readVar(s, "--tm-fail", "red"),
      warn: readVar(s, "--tm-warn", "orange"),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- theme switch re-reads tokens
  }, [theme]);
}

/** Adds alpha to a #rrggbb token colour (other formats are returned unchanged). */
export function withAlpha(color: string, alpha: number): string {
  if (/^#[0-9a-fA-F]{6}$/.test(color)) {
    return (
      color +
      Math.round(Math.max(0, Math.min(1, alpha)) * 255)
        .toString(16)
        .padStart(2, "0")
    );
  }
  return color;
}

/** Shared tooltip/axis styling built from tokens. */
export function baseChartOption(c: ChartColors): EChartsOption {
  return {
    animationDuration: 400,
    textStyle: { fontFamily: "Inter, system-ui, sans-serif", color: c.fgMuted },
    tooltip: {
      trigger: "axis",
      backgroundColor: c.surface,
      borderColor: c.line,
      borderWidth: 1,
      padding: [6, 10],
      textStyle: { color: c.fg, fontSize: 12 },
      axisPointer: { type: "line", lineStyle: { color: c.line } },
    },
  };
}
