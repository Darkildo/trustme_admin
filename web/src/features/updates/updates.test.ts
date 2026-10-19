import { describe, expect, it } from "vitest";
import type { NodeUpdate, NodeVersions } from "@/lib/types";
import {
  availableUpdate,
  bannerUpdate,
  compareVersions,
  deriveSteps,
  downgradeOf,
  imageTag,
  isLower,
  parseVersion,
  parseVersionLenient,
  updateButton,
} from "./updates";

const NOW = 1_800_000_000;

const current = (p: Partial<NodeVersions> = {}): NodeVersions => ({
  managed: true,
  agent: { arch: "x86_64", tmnode_version: "0.7.0" },
  node_image: "ghcr.io/darkildo/trustme_backend:v0.7.0",
  node_image_source: "agent",
  node_version: "0.7.0",
  tmnode_version: "0.7.0",
  supports_updates: true,
  min_agent_version: "0.3.0",
  agent_upgrade_command: "curl … | sudo sh -s -- agent-upgrade",
  ...p,
});

const update = (p: Partial<NodeUpdate> = {}): NodeUpdate => ({
  id: "01jb0000000000000000000000",
  node_id: "n",
  node_version: "0.7.1",
  tmnode_version: "0.7.1",
  tmnode_sha256: "a".repeat(64),
  allow_downgrade: false,
  state: "pending",
  step: null,
  error: null,
  from_node_image: null,
  to_node_image: null,
  from_tmnode: null,
  to_tmnode: null,
  created_by: "alice",
  created_at: NOW - 60,
  started_at: null,
  finished_at: null,
  reported_at: null,
  ...p,
});

describe("версии", () => {
  it("разбирает только X.Y.Z и сравнивает по числам", () => {
    expect(parseVersion("v0.7.0")).toEqual([0, 7, 0]);
    for (const bad of ["", "0.7", "0.7.0-rc1", "stable", "1.2.3.4", null])
      expect(parseVersion(bad)).toBeNull();
    expect(parseVersionLenient("0.3.0-dev")).toEqual([0, 3, 0]);
    expect(compareVersions([0, 10, 0], [0, 9, 9])).toBeGreaterThan(0);
    expect(compareVersions([1, 0, 0], [1, 0, 0])).toBe(0);
    expect(isLower("0.6.0", "0.7.0")).toBe(true);
    expect(isLower("0.10.0", "0.9.0")).toBe(false);
    expect(isLower("stable", "0.7.0")).toBe(false);
  });

  it("берёт тег образа", () => {
    expect(imageTag("ghcr.io/darkildo/trustme_backend:v0.7.0")).toBe("v0.7.0");
    expect(imageTag("localhost:5000/trustme_backend:stable@sha256:abc")).toBe("stable");
    expect(imageTag("localhost:5000/trustme_backend")).toBeNull();
    expect(imageTag(null)).toBeNull();
  });

  it("обновление доступно, если последний релиз новее ноды или агента", () => {
    expect(availableUpdate(current(), "0.7.1")).toBe("0.7.1");
    expect(availableUpdate(current(), "0.7.0")).toBeNull();
    expect(availableUpdate(current({ tmnode_version: "0.6.0" }), "0.7.0")).toBe("0.7.0");
    expect(availableUpdate(current({ node_version: null, tmnode_version: null }), "0.7.1")).toBe(
      null,
    );
    expect(availableUpdate(current(), null)).toBeNull();
    expect(availableUpdate(undefined, "0.7.1")).toBeNull();
  });

  it("понижение — только для выбранных частей", () => {
    expect(downgradeOf(current(), "0.6.0", { node: true, tmnode: true })).toEqual({
      node: true,
      tmnode: true,
    });
    expect(downgradeOf(current(), "0.6.0", { node: false, tmnode: true })).toEqual({
      node: false,
      tmnode: true,
    });
    expect(
      downgradeOf(current({ node_version: null }), "0.6.0", { node: true, tmnode: false }),
    ).toEqual({ node: false, tmnode: false });
    expect(downgradeOf(current(), "0.7.1", { node: true, tmnode: true })).toEqual({
      node: false,
      tmnode: false,
    });
  });
});

describe("кнопка «Обновить»", () => {
  it("только admin+ и только нодам с агентом", () => {
    expect(updateButton(current(), [], true)).toEqual({ kind: "ready" });
    expect(updateButton(current(), [], false)).toEqual({ kind: "hidden" });
    expect(updateButton(current({ managed: false }), [], true)).toEqual({ kind: "hidden" });
    expect(updateButton(current({ agent: null }), [], true)).toEqual({ kind: "hidden" });
    expect(updateButton(undefined, [], true)).toEqual({ kind: "hidden" });
  });

  it("старому агенту — объяснение, при активном задании — занято", () => {
    expect(updateButton(current({ supports_updates: false }), [], true)).toEqual({
      kind: "agent_too_old",
    });
    expect(updateButton(current(), [update({ state: "running" })], true)).toEqual({
      kind: "busy",
    });
    expect(updateButton(current(), [update({ state: "failed" })], true)).toEqual({
      kind: "ready",
    });
  });
});

describe("шаги задания", () => {
  const states = (u: NodeUpdate) => deriveSteps(u).map((s) => `${s.key}:${s.state}`);

  it("план зависит от того, что обновляем", () => {
    expect(states(update({ tmnode_version: null, tmnode_sha256: null }))).toEqual([
      "check:pending",
      "pull_image:pending",
      "recreate:pending",
      "verify:pending",
    ]);
    expect(states(update({ node_version: null }))).toEqual([
      "check:pending",
      "download_tmnode:pending",
      "restart_agent:pending",
    ]);
  });

  it("running: до шага — готово, шаг — идёт, после — ждёт", () => {
    expect(states(update({ state: "running", step: "pull_image" }))).toEqual([
      "check:done",
      "download_tmnode:done",
      "restart_agent:done",
      "pull_image:running",
      "recreate:pending",
      "verify:pending",
    ]);
    expect(states(update({ state: "running", step: null }))[0]).toBe("check:running");
  });

  it("итоги: успех, отказ, ошибка, откат, отмена", () => {
    expect(
      deriveSteps(update({ state: "succeeded", step: "verify" })).every((s) => s.state === "done"),
    ).toBe(true);
    expect(states(update({ state: "refused", step: "check", node_version: null }))).toEqual([
      "check:fail",
      "download_tmnode:skipped",
      "restart_agent:skipped",
    ]);
    expect(
      states(update({ state: "failed", step: "download_tmnode", node_version: null })),
    ).toEqual(["check:done", "download_tmnode:fail", "restart_agent:skipped"]);
    expect(
      states(update({ state: "rolled_back", step: "rollback", tmnode_version: null })),
    ).toEqual(["check:done", "pull_image:done", "recreate:done", "verify:fail", "rollback:done"]);
    expect(
      states(update({ state: "rolled_back", step: "recreate", tmnode_version: null })),
    ).toEqual([
      "check:done",
      "pull_image:done",
      "recreate:fail",
      "verify:skipped",
      "rollback:done",
    ]);
    expect(states(update({ state: "running", step: "rollback", tmnode_version: null }))).toEqual([
      "check:done",
      "pull_image:done",
      "recreate:done",
      "verify:fail",
      "rollback:running",
    ]);
    expect(deriveSteps(update({ state: "cancelled" })).every((s) => s.state === "skipped")).toBe(
      true,
    );
    expect(states(update({ state: "lost", step: "recreate", tmnode_version: null }))).toEqual([
      "check:done",
      "pull_image:done",
      "recreate:fail",
      "verify:skipped",
    ]);
  });
});

describe("полоса хода над вкладками", () => {
  it("активное — всегда, успех — час, ошибка — сутки", () => {
    expect(bannerUpdate([], NOW)).toBeNull();
    expect(bannerUpdate([update()], NOW)?.state).toBe("pending");
    const done = update({ state: "succeeded", finished_at: NOW - 2 * 3600 });
    expect(bannerUpdate([done], NOW)).toBeNull();
    expect(bannerUpdate([{ ...done, finished_at: NOW - 600 }], NOW)?.state).toBe("succeeded");
    const failed = update({ state: "rolled_back", finished_at: NOW - 5 * 3600 });
    expect(bannerUpdate([failed], NOW)?.state).toBe("rolled_back");
    expect(bannerUpdate([{ ...failed, finished_at: NOW - 2 * 86_400 }], NOW)).toBeNull();
    // Смотрим только на последнее задание.
    expect(bannerUpdate([done, update({ state: "running" })], NOW)).toBeNull();
  });
});
