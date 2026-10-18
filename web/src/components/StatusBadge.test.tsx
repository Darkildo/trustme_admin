import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { checkStatusMeta, nodeStatusMeta, reportToNodeStatus, worstNodeStatus } from "@/lib/status";
import type { CheckStatus, NodeStatus } from "@/lib/types";
import { CheckStatusIcon, StatusBadge } from "./StatusBadge";

describe("node status badge", () => {
  const cases: Array<[NodeStatus, string, string]> = [
    ["ok", "ok", "В порядке"],
    ["unknown", "unknown", "Нет данных"],
    ["warn", "warn", "Внимание"],
    ["stale", "stale", "Устарело"],
    ["fail", "fail", "Сломана"],
  ];

  it.each(cases)("maps %s to tone %s with label and icon", (status, tone, label) => {
    const { container } = render(<StatusBadge status={status} />);
    const badge = container.firstElementChild as HTMLElement;
    expect(badge).toHaveAttribute("data-tone", tone);
    expect(badge).toHaveAttribute("data-status", status);
    expect(badge).toHaveTextContent(label);
    expect(badge.className).toContain(`text-${tone}`);
    // Status is never conveyed by colour alone: an icon is always present.
    expect(badge.querySelector("svg")).not.toBeNull();
  });

  it("uses a distinct icon per status", () => {
    const icons = new Set(
      (["ok", "unknown", "warn", "stale", "fail"] as const).map((s) => nodeStatusMeta(s).icon),
    );
    expect(icons.size).toBe(5);
  });

  it("labels icon-only check statuses for assistive tech", () => {
    render(<CheckStatusIcon status="error" />);
    expect(screen.getByRole("img", { name: "Ошибка проверки" })).toBeInTheDocument();
  });

  it("maps check statuses to tones", () => {
    const tones: Record<CheckStatus, string> = {
      ok: "ok",
      skip: "skip",
      warn: "warn",
      error: "fail",
      fail: "fail",
    };
    for (const [s, tone] of Object.entries(tones))
      expect(checkStatusMeta(s as CheckStatus).tone).toBe(tone);
  });

  it("follows the api.md report → node mapping and ordering", () => {
    expect(reportToNodeStatus("ok")).toBe("ok");
    expect(reportToNodeStatus("skip")).toBe("ok");
    expect(reportToNodeStatus("warn")).toBe("warn");
    expect(reportToNodeStatus("error")).toBe("warn");
    expect(reportToNodeStatus("fail")).toBe("fail");
    expect(worstNodeStatus(["ok", "unknown"])).toBe("unknown");
    expect(worstNodeStatus(["warn", "stale", "ok"])).toBe("stale");
    expect(worstNodeStatus(["stale", "fail"])).toBe("fail");
  });
});
