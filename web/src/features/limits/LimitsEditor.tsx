import { CircleAlert, History, Pencil, RotateCcw, Search, SearchX } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip } from "@/components/ui/tooltip";
import type { Setting, SettingGroup, Settings } from "@/lib/types";
import { cn } from "@/lib/utils";
import { GROUP_ICONS, GROUP_ORDER } from "./meta";
import { ScopeBadge } from "./ScopeBadge";
import {
  amountText,
  bestFactor,
  factorById,
  formatSettingValue,
  fromAmount,
  parseAmount,
  unitFactors,
} from "./units";
import { serverErrorKey, validateSettings, withoutKey, type SettingError } from "./validation";

/** Which layer the editor edits: a profile (over node defaults) or node overrides (over a profile). */
export type LimitsLayer = "profile" | "override";

export interface LimitsEditorProps {
  catalog: readonly Setting[];
  /** Values set in this layer (draft). */
  values: Settings;
  /** Omit for read-only. */
  onChange?: (next: Settings) => void;
  layer: LimitsLayer;
  /** For `override`: settings of the node's profile and its name. */
  profileSettings?: Settings;
  profileName?: string;
  /** Last saved values of this layer: rows that differ get an «изменено» mark. */
  saved?: Settings;
  /** Server 400 message (raw); attributed to a row when it starts with «key:». */
  serverMessage?: string | null;
  className?: string;
}

type Filter = "all" | "set";

interface Inherited {
  value: number;
  source: "default" | "profile";
}

function useErrorText() {
  const { t, i18n } = useTranslation();
  return (setting: Setting, e: SettingError): string => {
    switch (e.code) {
      case "number":
        return t("limits.errors.number");
      case "integer":
        return t("limits.errors.integer");
      case "unknown":
        return t("limits.errors.unknown");
      case "range": {
        const fmt = (v: number) =>
          formatSettingValue(v, { ...setting, zero_unlimited: false }, t, i18n.language);
        return e.zero
          ? t("limits.errors.rangeOrZero", { min: fmt(e.min), max: fmt(e.max) })
          : t("limits.errors.range", { min: fmt(e.min), max: fmt(e.max) });
      }
    }
  };
}

/** Number + unit multiplier input that keeps what was typed («1.», «1,5») as is. */
function AmountInput({
  id,
  setting,
  value,
  onChange,
  invalid,
  describedBy,
  autoFocus,
  readOnly,
}: {
  id: string;
  setting: Setting;
  value: number;
  onChange: (v: number) => void;
  invalid: boolean;
  describedBy?: string;
  autoFocus?: boolean;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const factors = unitFactors(setting.unit);
  const [factorId, setFactorId] = React.useState(() => bestFactor(value, setting.unit).id);
  const [text, setText] = React.useState(() =>
    Number.isFinite(value) ? amountText(value, bestFactor(value, setting.unit)) : "",
  );
  // The value our text stands for; anything else coming from props is an external change.
  const [synced, setSynced] = React.useState(value);
  if (!Object.is(value, synced)) {
    const f = bestFactor(value, setting.unit);
    setSynced(value);
    setFactorId(f.id);
    setText(Number.isFinite(value) ? amountText(value, f) : "");
  }
  const factor = factorById(setting.unit, factorId);

  const emit = (nextText: string, nextFactorId: string) => {
    const amount = parseAmount(nextText);
    const raw =
      amount === null ? Number.NaN : fromAmount(amount, factorById(setting.unit, nextFactorId));
    setSynced(raw);
    onChange(raw);
  };

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        readOnly={readOnly}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          emit(e.target.value, factorId);
        }}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        className="h-8 min-w-0 flex-1 font-mono text-[13px] tabular"
      />
      {factors.length > 1 ? (
        <Select
          value={factor.id}
          disabled={readOnly}
          onValueChange={(v) => {
            setFactorId(v);
            emit(text, v);
          }}
        >
          <SelectTrigger
            className="h-8 w-[88px] shrink-0 px-2 font-mono text-xs"
            aria-label={t("limits.unitFor", { key: setting.key })}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {factors.map((f) => (
              <SelectItem key={f.id} value={f.id} className="font-mono text-xs">
                {t(f.labelKey)}
                {setting.unit === "bytes_per_day" ? t("limits.units.perDay") : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <span className="w-[88px] shrink-0 px-2 font-mono text-xs text-fg-subtle">
          {t(factor.labelKey)}
        </span>
      )}
    </div>
  );
}

interface RowProps {
  setting: Setting;
  value: number | undefined;
  inherited: Inherited;
  layer: LimitsLayer;
  profileName?: string;
  changed: boolean;
  error: string | null;
  focus: boolean;
  onSet?: (v: number) => void;
  onReset?: () => void;
}

function SettingRow({
  setting,
  value,
  inherited,
  layer,
  profileName,
  changed,
  error,
  focus,
  onSet,
  onReset,
}: RowProps) {
  const { t, i18n } = useTranslation();
  const id = React.useId();
  const errorId = `${id}-err`;
  const hintId = `${id}-hint`;
  // Restored when «без ограничения» is switched off again.
  const [lastNonZero, setLastNonZero] = React.useState<number>(() =>
    value !== undefined && value > 0 ? value : inherited.value || setting.default || setting.min,
  );
  if (value !== undefined && Number.isFinite(value) && value > 0 && value !== lastNonZero) {
    setLastNonZero(value);
  }

  const isSet = value !== undefined;
  const fmt = (v: number) => formatSettingValue(v, setting, t, i18n.language);
  const inheritedText =
    inherited.source === "profile"
      ? t("limits.inProfile", { name: profileName ?? "", value: fmt(inherited.value) })
      : t("limits.nodeDefault", { value: fmt(inherited.value) });
  const unlimited = isSet && value === 0 && setting.zero_unlimited;
  const flag = setting.unit === "flag";

  return (
    <li
      data-key={setting.key}
      className={cn(
        "grid gap-x-6 gap-y-2.5 px-4 py-3 sm:px-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]",
        isSet && "bg-accent-soft/40",
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={isSet && !unlimited ? id : undefined} className="text-sm text-fg">
          {setting.summary}
        </label>
        <div className="flex flex-wrap items-center gap-1.5">
          <code className="font-mono text-[11px] break-all text-fg-subtle" title={setting.env}>
            {setting.key}
          </code>
          <ScopeBadge scope={setting.scope} />
          {setting.since && (
            <Tooltip content={t("limits.sinceHint", { version: setting.since })}>
              <span
                tabIndex={0}
                className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-line px-1.5 font-mono text-[11px] whitespace-nowrap text-fg-subtle"
              >
                <History className="size-3" aria-hidden strokeWidth={2.25} />
                {t("limits.since", { version: setting.since })}
              </span>
            </Tooltip>
          )}
          {isSet ? (
            <span
              className={cn(
                "inline-flex h-5 items-center rounded-full border px-1.5 text-[11px] font-medium",
                layer === "override"
                  ? "border-accent-2/40 bg-accent-2/10 text-accent-2"
                  : "border-accent/35 bg-accent-soft text-accent",
              )}
            >
              {layer === "override" ? t("limits.sourceOverride") : t("limits.sourceProfile")}
            </span>
          ) : null}
          {changed && (
            <span className="inline-flex items-center gap-1 text-[11px] text-warn">
              <span aria-hidden className="size-1.5 rounded-full bg-warn" />
              {t("limits.changed")}
            </span>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-1.5">
        {!isSet ? (
          <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
            <span className="min-w-0">
              <span className="block font-mono text-[13px] text-fg-muted tabular">
                {fmt(inherited.value)}
              </span>
              <span className="block text-[11px] text-fg-subtle">
                {inherited.source === "profile"
                  ? t("limits.fromProfile", { name: profileName ?? "" })
                  : t("limits.fromDefault")}
              </span>
            </span>
            {onSet && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onSet(inherited.value)}
                aria-label={t("limits.setFor", { key: setting.key })}
              >
                <Pencil />
                {t("limits.set")}
              </Button>
            )}
            {error && (
              <p role="alert" className="basis-full text-xs text-fail">
                {error}
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              {unlimited ? (
                <span className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-dashed border-line-strong px-3 font-mono text-[13px] text-fg">
                  <span aria-hidden className="text-accent">
                    ∞
                  </span>
                  {t("limits.unlimited")}
                </span>
              ) : flag ? (
                <div className="flex h-8 min-w-0 flex-1 items-center gap-2.5">
                  <Switch
                    id={id}
                    checked={value === 1}
                    disabled={!onSet}
                    onCheckedChange={(on) => onSet?.(on ? 1 : 0)}
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? errorId : hintId}
                  />
                  <span className="text-[13px] text-fg">{fmt(value)}</span>
                </div>
              ) : (
                <div className="min-w-0 flex-1">
                  <AmountInput
                    id={id}
                    setting={setting}
                    value={value}
                    onChange={(v) => onSet?.(v)}
                    invalid={Boolean(error)}
                    describedBy={error ? errorId : hintId}
                    autoFocus={focus}
                    readOnly={!onSet}
                  />
                </div>
              )}
              {onReset && (
                <Tooltip
                  content={
                    layer === "override" ? t("limits.resetToProfile") : t("limits.resetToDefault")
                  }
                >
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={onReset}
                    aria-label={`${
                      layer === "override" ? t("limits.resetToProfile") : t("limits.resetToDefault")
                    }: ${setting.key}`}
                  >
                    <RotateCcw />
                  </Button>
                </Tooltip>
              )}
            </div>
            {setting.zero_unlimited && (
              <label className="flex w-fit items-center gap-2 text-xs text-fg-muted">
                <Switch
                  checked={unlimited}
                  disabled={!onSet}
                  onCheckedChange={(on) => onSet?.(on ? 0 : lastNonZero)}
                  aria-label={`${t("limits.unlimited")}: ${setting.key}`}
                />
                {t("limits.unlimited")}
              </label>
            )}
            {error ? (
              <p id={errorId} role="alert" className="text-xs text-fail">
                {error}
              </p>
            ) : (
              <p id={hintId} className="text-[11px] text-fg-subtle">
                {inheritedText}
              </p>
            )}
          </>
        )}
      </div>
    </li>
  );
}

/**
 * Catalog-driven limits form, grouped by `group`. Rows that this layer sets are editable;
 * the rest show what is inherited (node default or the profile) with a «Задать» action.
 */
export function LimitsEditor({
  catalog,
  values,
  onChange,
  layer,
  profileSettings = {},
  profileName,
  saved,
  serverMessage,
  className,
}: LimitsEditorProps) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<Filter>("all");
  const [focusKey, setFocusKey] = React.useState<string | null>(null);
  const searchId = React.useId();

  const errors = React.useMemo(() => validateSettings(catalog, values), [catalog, values]);
  const serverKey = serverMessage ? serverErrorKey(serverMessage, catalog) : null;
  const setCount = Object.keys(values).length;

  const q = query.trim().toLowerCase();
  const groups = React.useMemo(() => {
    const out: Array<{ group: SettingGroup; settings: Setting[]; set: number }> = [];
    for (const group of GROUP_ORDER) {
      const inGroup = catalog.filter((s) => s.group === group);
      const title = t(`limits.groups.${group}`).toLowerCase();
      const shown = inGroup.filter((s) => {
        if (filter === "set" && values[s.key] === undefined) return false;
        if (!q) return true;
        return (
          s.key.includes(q) ||
          s.env.toLowerCase().includes(q) ||
          s.summary.toLowerCase().includes(q) ||
          title.includes(q)
        );
      });
      if (shown.length > 0) {
        out.push({
          group,
          settings: shown,
          set: inGroup.filter((s) => values[s.key] !== undefined).length,
        });
      }
    }
    return out;
  }, [catalog, values, filter, q, t]);

  // Ошибку `key: …` показывает сама строка; баннер — только если строки не видно.
  const serverRowShown =
    serverKey !== null && groups.some((g) => g.settings.some((s) => s.key === serverKey));

  const inheritedOf = (s: Setting): Inherited =>
    layer === "override" && profileSettings[s.key] !== undefined
      ? { value: profileSettings[s.key]!, source: "profile" }
      : { value: s.default, source: "default" };

  const jump = (group: SettingGroup) => {
    const el = document.getElementById(`limits-group-${group}`);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative sm:w-80">
          <label htmlFor={searchId} className="sr-only">
            {t("limits.search")}
          </label>
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle"
            aria-hidden
          />
          <Input
            id={searchId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("limits.search")}
            className="pl-9"
          />
        </div>
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          label={t("limits.filter")}
          options={[
            { value: "all", label: t("limits.filterAll", { count: catalog.length }) },
            {
              value: "set",
              label:
                layer === "override"
                  ? t("limits.filterOverrides", { count: setCount })
                  : t("limits.filterSet", { count: setCount }),
            },
          ]}
        />
      </div>

      <nav aria-label={t("limits.groupsNav")} className="flex flex-wrap gap-1.5">
        {GROUP_ORDER.map((g) => {
          const Icon = GROUP_ICONS[g];
          const total = catalog.filter((s) => s.group === g).length;
          if (total === 0) return null;
          const set = catalog.filter((s) => s.group === g && values[s.key] !== undefined).length;
          return (
            <button
              key={g}
              type="button"
              onClick={() => jump(g)}
              className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line bg-surface-1 px-2.5 text-xs text-fg-muted transition-colors hover:border-line-strong hover:text-fg"
            >
              <Icon className="size-3.5 text-accent" aria-hidden />
              {t(`limits.groups.${g}`)}
              <span className="font-mono text-[11px] text-fg-subtle tabular">
                {set > 0 ? `${set}/${total}` : total}
              </span>
            </button>
          );
        })}
      </nav>

      {serverMessage && !serverRowShown && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md border border-fail/30 bg-fail-soft px-3 py-2 text-sm text-fg"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-fail" aria-hidden />
          <span className="min-w-0 break-words">{serverMessage}</span>
        </p>
      )}

      {groups.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-line-strong px-6 py-10 text-center">
          <SearchX className="size-5 text-fg-subtle" aria-hidden />
          <p className="text-sm text-fg-muted">
            {filter === "set" && !q ? t("limits.noneSet") : t("limits.noMatch")}
          </p>
          {(q || filter !== "all") && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setQuery("");
                setFilter("all");
              }}
            >
              {t("limits.showAll")}
            </Button>
          )}
        </div>
      ) : (
        groups.map(({ group, settings, set }) => {
          const Icon = GROUP_ICONS[group];
          return (
            <section
              key={group}
              id={`limits-group-${group}`}
              aria-labelledby={`limits-group-${group}-title`}
              className="scroll-mt-20 overflow-hidden rounded-lg border border-line bg-surface-1 shadow-sm"
            >
              <header className="flex items-center gap-3 border-b border-line bg-bg-elevated px-4 py-2.5 sm:px-5">
                <span className="flex size-7 items-center justify-center rounded-md bg-gradient-soft ring-1 ring-line-strong">
                  <Icon className="size-4 text-accent" aria-hidden />
                </span>
                <h3
                  id={`limits-group-${group}-title`}
                  className="text-[13px] font-semibold tracking-wide text-fg-muted uppercase"
                >
                  {t(`limits.groups.${group}`)}
                </h3>
                <span className="ml-auto text-xs text-fg-subtle tabular">
                  {set > 0
                    ? layer === "override"
                      ? t("limits.groupOverrides", { count: set })
                      : t("limits.groupSet", { count: set })
                    : t("limits.groupNoneSet")}
                </span>
              </header>
              <ul className="divide-y divide-line">
                {settings.map((s) => {
                  const v = values[s.key];
                  const local = errors[s.key];
                  const error = local
                    ? errorText(s, local)
                    : serverKey === s.key
                      ? (serverMessage ?? null)
                      : null;
                  return (
                    <SettingRow
                      key={s.key}
                      setting={s}
                      value={v}
                      inherited={inheritedOf(s)}
                      layer={layer}
                      profileName={profileName}
                      changed={saved !== undefined && !Object.is(saved[s.key], v)}
                      error={error}
                      focus={focusKey === s.key}
                      onSet={
                        onChange
                          ? (next) => {
                              if (v === undefined) setFocusKey(s.key);
                              onChange({ ...values, [s.key]: next });
                            }
                          : undefined
                      }
                      onReset={onChange ? () => onChange(withoutKey(values, s.key)) : undefined}
                    />
                  );
                })}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
