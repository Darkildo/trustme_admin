import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpCircle, Info, LoaderCircle, ShieldAlert, TriangleAlert } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { CodeBlock } from "@/components/CodeBlock";
import { ErrorState } from "@/components/ErrorState";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast-store";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { qk, releasesQuery } from "@/lib/queries";
import type { NodeVersions, ReleasesView, StartUpdateInput } from "@/lib/types";
import { cn } from "@/lib/utils";
import { SHA256_RE, defaultVersion, downgradeOf, hasTmnode, parseVersion } from "./updates";

interface Target {
  id: string;
  name: string;
}

/** Диалог «Обновить ноду»: версия, что обновлять, понижение; старому агенту — команда. */
export function UpdateDialog({
  node,
  current,
  open,
  onOpenChange,
}: {
  node: Target;
  current: NodeVersions;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("updates.dialog.title", { name: node.name })}</DialogTitle>
          <DialogDescription>{t("updates.dialog.description")}</DialogDescription>
        </DialogHeader>
        {current.supports_updates ? (
          <ReleasePicker node={node} current={current} onDone={() => onOpenChange(false)} />
        ) : (
          <OldAgent current={current} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function OldAgent({ current }: { current: NodeVersions }) {
  const { t } = useTranslation();
  return (
    <>
      <DialogBody className="flex flex-col gap-3">
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-md border border-warn/30 bg-warn-soft px-3 py-2.5"
        >
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
          <div className="flex flex-col gap-1 text-sm">
            <p className="font-medium text-fg">
              {t("updates.dialog.oldAgentTitle", {
                version: current.tmnode_version ?? "—",
              })}
            </p>
            <p className="text-fg-muted">
              {t("updates.dialog.oldAgentText", { min: current.min_agent_version })}
            </p>
          </div>
        </div>
        <CodeBlock code={current.agent_upgrade_command} label={t("updates.dialog.commandLabel")} />
        <p className="text-xs text-fg-subtle">{t("updates.dialog.oldAgentAfter")}</p>
      </DialogBody>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="secondary">{t("common.close")}</Button>
        </DialogClose>
      </DialogFooter>
    </>
  );
}

function ReleasePicker({
  node,
  current,
  onDone,
}: {
  node: Target;
  current: NodeVersions;
  onDone: () => void;
}) {
  const releases = useQuery(releasesQuery);
  if (releases.isPending) {
    return (
      <DialogBody className="flex flex-col gap-3">
        <Skeleton className="h-9" />
        <Skeleton className="h-24" />
      </DialogBody>
    );
  }
  if (releases.isError) {
    return (
      <DialogBody>
        <ErrorState error={releases.error} onRetry={() => void releases.refetch()} />
      </DialogBody>
    );
  }
  return (
    <UpdateForm
      key={releases.data.latest ?? "manual"}
      node={node}
      current={current}
      releases={releases.data}
      onDone={onDone}
    />
  );
}

/** Форма: версия из релизов (или вручную, если релизы выключены) и что обновлять. */
export function UpdateForm({
  node,
  current,
  releases,
  onDone,
}: {
  node: Target;
  current: NodeVersions;
  releases: ReleasesView;
  onDone: () => void;
}) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const manual = !releases.enabled;
  const arch = current.agent?.arch;
  const [version, setVersion] = React.useState(() => defaultVersion(releases) ?? "");
  const [manualVersion, setManualVersion] = React.useState("");
  const [sha, setSha] = React.useState("");
  const release = releases.releases.find((r) => r.version === version);
  const tmnodeAvailable = manual || hasTmnode(release, arch);
  const [parts, setParts] = React.useState({ node: true, tmnode: true });
  const [allowDowngrade, setAllowDowngrade] = React.useState(false);
  const [touched, setTouched] = React.useState(false);
  const nodeId = React.useId();
  const tmnodeId = React.useId();
  const downgradeId = React.useId();

  const target = manual ? manualVersion.trim().replace(/^v/, "") : version;
  const want = { node: parts.node, tmnode: parts.tmnode && tmnodeAvailable };
  const down = downgradeOf(current, target, want);
  const isDowngrade = down.node || down.tmnode;
  const same = {
    node: want.node && current.node_version === target,
    tmnode: want.tmnode && current.tmnode_version === target,
  };
  const nothing = !want.node && !want.tmnode;
  const nothingNew = !nothing && (!want.node || same.node) && (!want.tmnode || same.tmnode);
  const versionError =
    manual && (touched || manualVersion !== "") && parseVersion(target) === null
      ? t("updates.dialog.invalidVersion")
      : null;
  const shaError =
    manual && want.tmnode && (touched || sha !== "") && !SHA256_RE.test(sha.trim())
      ? t("updates.dialog.invalidSha")
      : null;

  const start = useMutation({
    mutationFn: (input: StartUpdateInput) => api.nodes.startUpdate(node.id, input),
    onSuccess: () => {
      toast.success(t("updates.dialog.started", { name: node.name, version: `v${target}` }));
      void qc.invalidateQueries({ queryKey: qk.updates(node.id) });
      onDone();
    },
  });

  const blocked =
    nothing ||
    nothingNew ||
    (isDowngrade && !allowDowngrade) ||
    parseVersion(target) === null ||
    (manual && want.tmnode && !SHA256_RE.test(sha.trim())) ||
    start.isPending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (blocked) return;
    start.mutate({
      node_version: want.node ? target : undefined,
      tmnode_version: want.tmnode ? target : undefined,
      tmnode_sha256: manual && want.tmnode ? sha.trim().toLowerCase() : undefined,
      allow_downgrade: isDowngrade ? true : undefined,
    });
  };

  const from = (v: string | null) => (v ? `v${v}` : t("updates.dialog.unknown"));

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogBody className="flex flex-col gap-4">
        {manual ? (
          <>
            <div className="flex items-start gap-2.5 rounded-md border border-line bg-bg-elevated px-3 py-2.5 text-sm">
              <Info className="mt-0.5 size-4 shrink-0 text-unknown" aria-hidden />
              <div>
                <p className="font-medium text-fg">{t("updates.dialog.manualTitle")}</p>
                <p className="text-fg-muted">{t("updates.dialog.manualText")}</p>
              </div>
            </div>
            <Field label={t("updates.dialog.manualVersion")} error={versionError}>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  className="font-mono"
                  placeholder="0.7.0"
                  autoComplete="off"
                  value={manualVersion}
                  onChange={(e) => setManualVersion(e.target.value)}
                />
              )}
            </Field>
          </>
        ) : (
          <Field label={t("updates.dialog.version")}>
            {({ id }) => (
              <Select value={version} onValueChange={setVersion}>
                <SelectTrigger id={id} className="w-full font-mono">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {releases.releases.map((r) => (
                    <SelectItem key={r.version} value={r.version}>
                      <span className="font-mono">{r.tag}</span>
                      {r.version === releases.latest && (
                        <span className="ml-2 text-xs text-accent">
                          {t("updates.dialog.latest")}
                        </span>
                      )}
                      {r.published_at !== null && (
                        <span className="ml-2 text-xs text-fg-subtle">
                          {formatDateTime(r.published_at, i18n.language)}
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
        )}

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium text-fg">{t("updates.dialog.parts")}</legend>
          <PartRow
            id={nodeId}
            checked={parts.node}
            onChange={(node) => setParts((p) => ({ ...p, node }))}
            label={t("updates.dialog.partNode")}
            detail={
              same.node
                ? t("updates.dialog.same")
                : `${from(current.node_version)} → v${target || "…"}`
            }
          />
          <PartRow
            id={tmnodeId}
            checked={parts.tmnode && tmnodeAvailable}
            disabled={!tmnodeAvailable}
            onChange={(tmnode) => setParts((p) => ({ ...p, tmnode }))}
            label={t("updates.dialog.partTmnode")}
            detail={
              !tmnodeAvailable
                ? t("updates.dialog.noTmnode", { arch: arch ?? "?" })
                : same.tmnode
                  ? t("updates.dialog.same")
                  : `${from(current.tmnode_version)} → ${target || "…"}`
            }
          />
        </fieldset>

        {manual && want.tmnode && (
          <Field
            label={t("updates.dialog.manualSha", { arch: arch ?? "<arch>" })}
            hint={t("updates.dialog.manualShaHint")}
            error={shaError}
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                className="font-mono text-xs"
                autoComplete="off"
                spellCheck={false}
                value={sha}
                onChange={(e) => setSha(e.target.value)}
              />
            )}
          </Field>
        )}

        {want.node && current.node_version === null && (
          <p className="flex items-start gap-2 rounded-md border border-line bg-bg-elevated px-3 py-2.5 text-sm text-fg-muted">
            <Info className="mt-0.5 size-4 shrink-0 text-unknown" aria-hidden />
            {t("updates.dialog.unknownNode", { image: current.node_image ?? "—" })}
          </p>
        )}

        {want.node && !same.node && (
          <p className="flex items-start gap-2 rounded-md border border-stale/30 bg-stale-soft px-3 py-2.5 text-sm text-fg">
            <Info className="mt-0.5 size-4 shrink-0 text-stale" aria-hidden />
            {t("updates.dialog.restartWarn")}
          </p>
        )}

        {isDowngrade && (
          <div
            role="alert"
            className="flex flex-col gap-2.5 rounded-md border border-fail/35 bg-fail-soft px-3 py-2.5"
          >
            <p className="flex items-start gap-2 text-sm text-fg">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-fail" aria-hidden />
              <span>
                <span className="font-medium">{t("updates.dialog.downgradeTitle")}. </span>
                {t("updates.dialog.downgradeText")}
              </span>
            </p>
            <label htmlFor={downgradeId} className="flex items-center gap-2 text-sm text-fg">
              <Checkbox
                id={downgradeId}
                checked={allowDowngrade}
                onCheckedChange={(v) => setAllowDowngrade(v === true)}
              />
              {t("updates.dialog.downgradeConfirm")}
            </label>
          </div>
        )}

        {nothing && touched && (
          <p className="text-sm text-fail" role="alert">
            {t("updates.dialog.nothing")}
          </p>
        )}
        {nothingNew && (
          <p className="text-sm text-fg-muted" role="status">
            {t("updates.dialog.nothingNew")}
          </p>
        )}
        {start.isError && (
          <p
            role="alert"
            className="rounded-md border border-fail/30 bg-fail-soft px-3 py-2 text-sm break-words text-fg"
          >
            {errorMessage(start.error, t)}
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" variant="primary" disabled={blocked}>
          {start.isPending ? <LoaderCircle className="animate-spin" /> : <ArrowUpCircle />}
          {start.isPending ? t("updates.dialog.submitting") : t("updates.dialog.submit")}
        </Button>
      </DialogFooter>
    </form>
  );
}

function PartRow({
  id,
  checked,
  disabled,
  onChange,
  label,
  detail,
}: {
  id: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  label: string;
  detail: string;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex items-center gap-3 rounded-md border border-line bg-bg-elevated px-3.5 py-2.5",
        disabled ? "opacity-60" : "cursor-pointer hover:bg-surface-2",
      )}
    >
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onChange(v === true)}
      />
      <span className="text-sm font-medium text-fg">{label}</span>
      <span className="ml-auto font-mono text-xs text-fg-muted tabular">{detail}</span>
    </label>
  );
}
