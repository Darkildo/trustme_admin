import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Cpu, PhoneCall, Timer, TriangleAlert } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useUi } from "@/app/ui-context";
import { useCan } from "@/app/useCurrentUser";
import { ErrorState } from "@/components/ErrorState";
import { LiveDot } from "@/components/LiveDot";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast-store";
import { LimitsEditor } from "@/features/limits/LimitsEditor";
import { SaveBar } from "@/features/limits/SaveBar";
import { formatSettingValue } from "@/features/limits/units";
import { sameSettings, validateSettings, withoutKey } from "@/features/limits/validation";
import { TurnPicker } from "@/features/turn/TurnPicker";
import { api, isApiError } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { formatDateTime, formatRelative } from "@/lib/format";
import { catalogQuery, profilesQuery, qk, runtimeQuery, turnServersQuery } from "@/lib/queries";
import type {
  AgentInfo,
  NodeDetail,
  NodeRuntime,
  Profile,
  Setting,
  Settings,
  TurnServer,
  UpdateNodeInput,
} from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { cn } from "@/lib/utils";
import { ApplyBanner } from "./ApplyBanner";

const TTL_KEY = "ice_credential_ttl_secs";
const TTL_PRESETS = [1800, 3600, 7200, 21_600, 43_200, 86_400];

function AgentCard({ agent, node }: { agent: AgentInfo | null; node: NodeDetail }) {
  const { t, i18n } = useTranslation();
  const { openInstall } = useUi();
  const canAdmin = useCan("admin");
  const now = useNow(10_000) / 1000;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cpu className="size-3.5" aria-hidden />
          {t("runtime.agent.title")}
        </CardTitle>
        {agent && (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-xs font-medium",
              agent.online ? "text-ok" : "text-fg-subtle",
            )}
          >
            {agent.online ? (
              <LiveDot tone="ok" />
            ) : (
              <span aria-hidden className="size-2.5 rounded-full border-2 border-fg-subtle" />
            )}
            {agent.online ? t("runtime.agent.online") : t("runtime.agent.offline")}
          </span>
        )}
      </CardHeader>
      <CardContent>
        {agent ? (
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
            <dt className="text-fg-subtle">{t("runtime.agent.hostname")}</dt>
            <dd className="truncate font-mono text-[13px] text-fg">{agent.hostname}</dd>
            <dt className="text-fg-subtle">{t("runtime.agent.arch")}</dt>
            <dd className="font-mono text-[13px] text-fg">{agent.arch}</dd>
            <dt className="text-fg-subtle">{t("runtime.agent.version")}</dt>
            <dd className="font-mono text-[13px] text-fg">{agent.tmnode_version}</dd>
            <dt className="text-fg-subtle">{t("runtime.agent.enrolled")}</dt>
            <dd
              className="text-fg tabular"
              title={formatDateTime(agent.enrolled_at, i18n.language)}
            >
              {formatRelative(agent.enrolled_at, i18n.language, now)}
            </dd>
            <dt className="text-fg-subtle">{t("runtime.agent.lastSeen")}</dt>
            <dd
              className="text-fg tabular"
              title={
                agent.last_seen_at ? formatDateTime(agent.last_seen_at, i18n.language) : undefined
              }
            >
              {agent.last_seen_at
                ? formatRelative(agent.last_seen_at, i18n.language, now)
                : t("runtime.agent.never")}
            </dd>
          </dl>
        ) : node.provisioning ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-fg-muted">{t("runtime.agent.waiting")}</p>
            {canAdmin && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => openInstall({ id: node.id, name: node.name, addr: node.addr })}
              >
                {t("node.install")}
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-fg">{t("runtime.agent.none")}</p>
            <p className="text-xs text-fg-muted">{t("runtime.agent.noneText")}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface Draft {
  profileId: string;
  overrides: Settings;
  turnIds: string[];
}

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}

function TtlPicker({
  setting,
  profileValue,
  value,
  onChange,
  disabled,
}: {
  setting: Setting;
  profileValue: number;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  disabled: boolean;
}) {
  const { t, i18n } = useTranslation();
  const fmt = (v: number) => formatSettingValue(v, setting, t, i18n.language);
  const options: Array<{ v: number | undefined; label: string }> = [
    { v: undefined, label: t("runtime.ttlInherit", { value: fmt(profileValue) }) },
    ...TTL_PRESETS.map((v) => ({ v, label: fmt(v) })),
  ];
  if (value !== undefined && !TTL_PRESETS.includes(value))
    options.push({ v: value, label: fmt(value) });
  return (
    <div role="group" aria-label={t("runtime.ttlLabel")} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = o.v === value;
        return (
          <button
            key={o.v ?? "inherit"}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onChange(o.v)}
            className={cn(
              "inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-medium transition-colors disabled:cursor-default",
              on
                ? "border-accent/40 bg-accent-soft text-fg"
                : "border-line bg-surface-1 text-fg-muted enabled:hover:border-line-strong enabled:hover:text-fg",
              o.v !== undefined && "font-mono tabular",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function LimitsForm({
  node,
  runtime,
  catalog,
  profiles,
  turn,
}: {
  node: NodeDetail;
  runtime: NodeRuntime;
  catalog: Setting[];
  profiles: Profile[];
  turn: TurnServer[];
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const canAdmin = useCan("admin");
  const initial: Draft = {
    profileId: runtime.profile.id,
    overrides: runtime.overrides,
    turnIds: runtime.turn_server_ids,
  };
  const [draft, setDraft] = React.useState<Draft>(initial);
  // Manually added nodes have no agent and never will: editing would be misleading.
  const manual = runtime.state === "no_agent" && runtime.provision === null;
  const editable = canAdmin && !manual;

  const profile = profiles.find((p) => p.id === draft.profileId);
  const profileSettings = profile?.settings ?? {};
  const profileName = profile?.name ?? runtime.profile.name;
  const ttlSetting = catalog.find((s) => s.key === TTL_KEY);

  const dirty =
    draft.profileId !== initial.profileId ||
    !sameSettings(draft.overrides, initial.overrides) ||
    !sameIds(draft.turnIds, initial.turnIds);
  const invalid = Object.keys(validateSettings(catalog, draft.overrides)).length > 0;

  const save = useMutation({
    mutationFn: () => {
      const body: UpdateNodeInput = {};
      if (draft.profileId !== initial.profileId) {
        const chosen = profiles.find((p) => p.id === draft.profileId);
        // The default profile is stored as "" so the node follows whichever profile is default.
        body.profile_id = chosen?.is_default ? "" : draft.profileId;
      }
      if (!sameSettings(draft.overrides, initial.overrides)) body.overrides = draft.overrides;
      if (!sameIds(draft.turnIds, initial.turnIds)) body.turn_server_ids = draft.turnIds;
      return api.nodes.update(node.id, body);
    },
    onSuccess: (updated) => {
      qc.setQueryData(qk.node(node.id), updated);
      void qc.invalidateQueries({ queryKey: qk.runtime(node.id) });
      void qc.invalidateQueries({ queryKey: qk.profiles });
      void qc.invalidateQueries({ queryKey: qk.turn });
      toast.success(t("runtime.saved"));
    },
  });

  const serverMessage =
    save.error && isApiError(save.error, "invalid_input")
      ? save.error.message
      : save.error
        ? errorMessage(save.error, t)
        : null;

  const update = (patch: Partial<Draft>) => {
    if (save.error) save.reset();
    setDraft((d) => ({ ...d, ...patch }));
  };

  const assigned = turn.filter((s) => draft.turnIds.includes(s.id));

  return (
    <>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("runtime.profileTitle")}</CardTitle>
              <Button asChild variant="link" size="sm" className="text-xs">
                <Link to="/limits" search={{ profile: draft.profileId }}>
                  {t("runtime.openProfile")}
                  <ArrowUpRight className="size-3.5" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Select
                value={draft.profileId}
                disabled={!editable}
                onValueChange={(profileId) => update({ profileId })}
              >
                <SelectTrigger className="w-full sm:w-80" aria-label={t("runtime.profileTitle")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                      {p.is_default &&
                      p.name.toLowerCase() !== t("runtime.profileDefault").toLowerCase()
                        ? ` · ${t("runtime.profileDefault")}`
                        : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-fg-subtle">{t("runtime.profileHint")}</p>
            </CardContent>
          </Card>

          <section aria-labelledby="overrides-title" className="flex flex-col gap-3">
            <div>
              <h2
                id="overrides-title"
                className="text-[13px] font-semibold tracking-wide text-fg-muted uppercase"
              >
                {t("runtime.overridesTitle")}
              </h2>
              <p className="mt-0.5 text-xs text-fg-subtle">
                {t("runtime.overridesHint", { name: profileName })}
              </p>
            </div>
            <LimitsEditor
              catalog={catalog}
              values={draft.overrides}
              saved={initial.overrides}
              onChange={editable ? (overrides) => update({ overrides }) : undefined}
              layer="override"
              profileSettings={profileSettings}
              profileName={profileName}
              serverMessage={serverMessage}
            />
          </section>
        </div>

        <aside className="flex flex-col gap-4 xl:sticky xl:top-[calc(var(--tm-topbar-h)+20px)]">
          <AgentCard agent={runtime.agent} node={node} />

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PhoneCall className="size-3.5" aria-hidden />
                {t("runtime.turnTitle")}
              </CardTitle>
              <Button asChild variant="link" size="sm" className="text-xs">
                <Link to="/turn">
                  {t("runtime.turnManage")}
                  <ArrowUpRight className="size-3.5" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="text-xs text-fg-subtle">{t("runtime.turnHint")}</p>
              {turn.length === 0 ? (
                <p className="text-sm text-fg-muted">{t("runtime.turnEmpty")}</p>
              ) : (
                <TurnPicker
                  servers={turn}
                  value={draft.turnIds}
                  onChange={editable ? (turnIds) => update({ turnIds }) : undefined}
                  label={t("runtime.turnTitle")}
                  highlightNodeId={node.id}
                />
              )}
              {assigned.length === 0 && (
                <p className="flex items-start gap-2 text-xs text-warn">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  {t("runtime.turnNone")}
                </p>
              )}
            </CardContent>
          </Card>

          {ttlSetting && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Timer className="size-3.5" aria-hidden />
                  {t("runtime.ttlTitle")}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2.5">
                <TtlPicker
                  setting={ttlSetting}
                  profileValue={profileSettings[TTL_KEY] ?? ttlSetting.default}
                  value={draft.overrides[TTL_KEY]}
                  disabled={!editable}
                  onChange={(v) =>
                    update({
                      overrides:
                        v === undefined
                          ? withoutKey(draft.overrides, TTL_KEY)
                          : { ...draft.overrides, [TTL_KEY]: v },
                    })
                  }
                />
                <p className="text-xs text-fg-subtle">{t("runtime.ttlHint")}</p>
              </CardContent>
            </Card>
          )}
        </aside>
      </div>

      <SaveBar
        dirty={dirty}
        invalid={invalid}
        pending={save.isPending}
        onSave={() => save.mutate()}
        onDiscard={() => {
          save.reset();
          setDraft(initial);
        }}
      />
    </>
  );
}

/** «Лимиты и звонки»: apply state, profile, overrides, TURN servers and the agent. */
export function LimitsTab({ node }: { node: NodeDetail }) {
  const rt = useQuery(runtimeQuery(node.id));
  const catalog = useQuery(catalogQuery);
  const profiles = useQuery(profilesQuery);
  const turn = useQuery(turnServersQuery);

  const failed = rt.error ?? catalog.error ?? profiles.error ?? turn.error;
  if (failed) {
    return (
      <ErrorState
        error={failed}
        onRetry={() => {
          void rt.refetch();
          void catalog.refetch();
          void profiles.refetch();
          void turn.refetch();
        }}
      />
    );
  }
  if (!rt.data || !catalog.data || !profiles.data || !turn.data) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-20 rounded-lg" />
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex flex-col gap-4">
            <Skeleton className="h-28 rounded-lg" />
            <Skeleton className="h-96 rounded-lg" />
          </div>
          <div className="flex flex-col gap-4">
            <Skeleton className="h-48 rounded-lg" />
            <Skeleton className="h-36 rounded-lg" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ApplyBanner node={node} runtime={rt.data} catalog={catalog.data} />
      <LimitsForm
        key={rt.data.desired_version}
        node={node}
        runtime={rt.data}
        catalog={catalog.data}
        profiles={profiles.data}
        turn={turn.data}
      />
    </div>
  );
}
