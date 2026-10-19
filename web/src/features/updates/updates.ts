import {
  Ban,
  CircleCheck,
  CircleX,
  Clock,
  LoaderCircle,
  OctagonAlert,
  Undo2,
  Unplug,
  type LucideIcon,
} from "lucide-react";
import type { Tone } from "@/lib/status";
import type {
  NodeUpdate,
  NodeVersions,
  Release,
  ReleasesView,
  UpdateJobState,
  UpdateStep,
} from "@/lib/types";

/** Версия X.Y.Z тремя числами. */
export type Version = readonly [number, number, number];

/** Строго `X.Y.Z` (можно с `v`); pre-release и метки сборки — не версия релиза. */
export function parseVersion(s: string | null | undefined): Version | null {
  const m = /^v?(\d{1,9})\.(\d{1,9})\.(\d{1,9})$/.exec((s ?? "").trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Версия, которую прислал агент: `0.3.0-dev` → 0.3.0. */
export function parseVersionLenient(s: string | null | undefined): Version | null {
  const m = /^v?(\d{1,9}\.\d{1,9}\.\d{1,9})/.exec((s ?? "").trim());
  return m ? parseVersion(m[1]) : null;
}

/** Семантическое сравнение: <0, 0, >0. `0.10.0` новее `0.9.9`. */
export function compareVersions(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return 0;
}

/** «a ниже b»; неизвестная версия ни с чем не сравнивается. */
export function isLower(a: string | null | undefined, b: string | null | undefined): boolean {
  const va = parseVersionLenient(a);
  const vb = parseVersionLenient(b);
  return va !== null && vb !== null && compareVersions(va, vb) < 0;
}

/** Тег образа: `ghcr.io/…/trustme_backend:v0.7.0` → «v0.7.0», без тега — null. */
export function imageTag(image: string | null | undefined): string | null {
  if (!image) return null;
  const name = image.split("@")[0]!.split("/").pop() ?? "";
  const i = name.indexOf(":");
  return i < 0 ? null : name.slice(i + 1) || null;
}

/**
 * Последний релиз, если он новее ноды или агента. Неизвестная версия (`:stable`)
 * обновления не «просит»: сравнивать не с чем.
 */
export function availableUpdate(
  current: Pick<NodeVersions, "node_version" | "tmnode_version"> | undefined,
  latest: string | null | undefined,
): string | null {
  if (!current || !latest) return null;
  const newer =
    isLower(current.node_version, latest) ||
    (current.tmnode_version !== null && isLower(current.tmnode_version, latest));
  return newer ? latest : null;
}

export const ACTIVE_STATES: readonly UpdateJobState[] = ["pending", "running"];

export function isActive(u: Pick<NodeUpdate, "state"> | null | undefined): boolean {
  return !!u && ACTIVE_STATES.includes(u.state);
}

/** Итог с причиной, которую надо показать. */
export function isProblem(state: UpdateJobState): boolean {
  return state === "failed" || state === "rolled_back" || state === "refused" || state === "lost";
}

/** Активное задание ноды (новые первыми — значит, первое). */
export function activeUpdate(updates: readonly NodeUpdate[] | undefined): NodeUpdate | null {
  const first = updates?.[0];
  return first && isActive(first) ? first : null;
}

/** Сколько показывать итог над вкладками: успех и отмену — час, ошибку — сутки. */
export const SHOW_DONE_SECS = 3600;
export const SHOW_PROBLEM_SECS = 86_400;

/** Задание для полосы хода: активное или недавно завершённое последнее. */
export function bannerUpdate(
  updates: readonly NodeUpdate[] | undefined,
  nowSec: number,
): NodeUpdate | null {
  const latest = updates?.[0];
  if (!latest) return null;
  if (isActive(latest)) return latest;
  const at = latest.finished_at ?? latest.created_at;
  const keep = isProblem(latest.state) ? SHOW_PROBLEM_SECS : SHOW_DONE_SECS;
  return nowSec - at <= keep ? latest : null;
}

/** Что показать вместо кнопки «Обновить». */
export type UpdateButton =
  { kind: "hidden" } | { kind: "busy" } | { kind: "agent_too_old" } | { kind: "ready" };

/** Кнопка — только admin+ и только нодам с агентом; старому агенту — объяснение в диалоге. */
export function updateButton(
  current: NodeVersions | undefined,
  updates: readonly NodeUpdate[] | undefined,
  canAdmin: boolean,
): UpdateButton {
  if (!canAdmin || !current || !current.managed || !current.agent) return { kind: "hidden" };
  if (activeUpdate(updates)) return { kind: "busy" };
  return current.supports_updates ? { kind: "ready" } : { kind: "agent_too_old" };
}

export interface StateMeta {
  tone: Tone;
  icon: LucideIcon;
  spinning: boolean;
}

const STATE_META: Record<UpdateJobState, StateMeta> = {
  pending: { tone: "stale", icon: Clock, spinning: false },
  running: { tone: "unknown", icon: LoaderCircle, spinning: true },
  succeeded: { tone: "ok", icon: CircleCheck, spinning: false },
  failed: { tone: "fail", icon: CircleX, spinning: false },
  rolled_back: { tone: "warn", icon: Undo2, spinning: false },
  refused: { tone: "warn", icon: Ban, spinning: false },
  cancelled: { tone: "skip", icon: Ban, spinning: false },
  lost: { tone: "fail", icon: Unplug, spinning: false },
};

export function updateStateMeta(state: UpdateJobState): StateMeta {
  return STATE_META[state] ?? { tone: "unknown", icon: OctagonAlert, spinning: false };
}

export type StepState = "pending" | "running" | "done" | "fail" | "skipped";

export interface StepView {
  key: UpdateStep;
  state: StepState;
}

/** Шаги задания по протоколу: check → tmnode → нода → verify, при откате — rollback. */
export function plannedSteps(u: Pick<NodeUpdate, "node_version" | "tmnode_version">): UpdateStep[] {
  const steps: UpdateStep[] = ["check"];
  if (u.tmnode_version) steps.push("download_tmnode", "restart_agent");
  if (u.node_version) steps.push("pull_image", "recreate", "verify");
  return steps;
}

/** Состояние каждого шага по статусу задания. */
export function deriveSteps(
  u: Pick<NodeUpdate, "node_version" | "tmnode_version" | "state" | "step">,
): StepView[] {
  const steps = plannedSteps(u);
  if (u.state === "rolled_back" && !steps.includes("rollback")) steps.push("rollback");
  if (u.step && !steps.includes(u.step)) steps.push(u.step);
  const at = u.step ? steps.indexOf(u.step) : -1;
  const view = (fn: (i: number, key: UpdateStep) => StepState): StepView[] =>
    steps.map((key, i) => ({ key, state: fn(i, key) }));

  switch (u.state) {
    case "pending":
      return view(() => "pending");
    case "cancelled":
      return view(() => "skipped");
    case "succeeded":
      return view(() => "done");
    case "running": {
      const cur = Math.max(at, 0);
      // Идёт откат: шаг перед ним не прошёл.
      const failed = u.step === "rollback" ? cur - 1 : -1;
      return view((i) =>
        i === failed ? "fail" : i < cur ? "done" : i === cur ? "running" : "pending",
      );
    }
    case "rolled_back": {
      // Откат идёт после неудачного шага ноды: он — тот, что перед rollback,
      // если агент сообщил шаг rollback, иначе сообщённый.
      const rb = steps.indexOf("rollback");
      const failed = u.step === "rollback" || at < 0 ? rb - 1 : at;
      return view((i, key) =>
        key === "rollback" ? "done" : i < failed ? "done" : i === failed ? "fail" : "skipped",
      );
    }
    case "failed":
    case "refused":
    case "lost": {
      const failed = Math.max(at, 0);
      return view((i) => (i < failed ? "done" : i === failed ? "fail" : "skipped"));
    }
  }
}

/** Понижение относительно текущих версий для выбранных частей. */
export function downgradeOf(
  current: Pick<NodeVersions, "node_version" | "tmnode_version">,
  target: string,
  parts: { node: boolean; tmnode: boolean },
): { node: boolean; tmnode: boolean } {
  return {
    node: parts.node && isLower(target, current.node_version),
    tmnode: parts.tmnode && isLower(target, current.tmnode_version),
  };
}

/** Есть ли в релизе бинарь tmnode под архитектуру агента. */
export function hasTmnode(release: Release | undefined, arch: string | undefined): boolean {
  return !!release && !!arch && release.tmnode[arch] === true;
}

/** Версия по умолчанию в диалоге — последняя. */
export function defaultVersion(view: ReleasesView | undefined): string | null {
  return view?.latest ?? view?.releases[0]?.version ?? null;
}

export const SHA256_RE = /^[0-9a-fA-F]{64}$/;
