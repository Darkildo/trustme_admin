import { useQuery } from "@tanstack/react-query";
import { Database, HardDrive, PhoneCall } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { DialogBody, DialogFooter } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TurnPicker } from "@/features/turn/TurnPicker";
import { profilesQuery, turnServersQuery } from "@/lib/queries";
import type { Backend } from "@/lib/types";
import {
  COTURN_PORTS,
  validateProvisionForm,
  type ProvisionFormErrors,
  type ProvisionFormValues,
} from "./validation";

const DEFAULT = "__default__";

/** «Поставить на новый сервер», step 1: where and how the node will run. */
export function ProvisionForm({
  values,
  onChange,
  onSubmit,
  onCancel,
  pending,
  serverError,
}: {
  values: ProvisionFormValues;
  onChange: (v: ProvisionFormValues) => void;
  onSubmit: () => void;
  onCancel: () => void;
  pending: boolean;
  serverError: string | null;
}) {
  const { t } = useTranslation();
  const profiles = useQuery(profilesQuery).data ?? [];
  const turn = useQuery(turnServersQuery).data ?? [];
  const [touched, setTouched] = React.useState(false);
  const errors: ProvisionFormErrors = touched ? validateProvisionForm(values) : {};
  const err = (k: keyof ProvisionFormErrors) => (errors[k] ? t(errors[k]) : null);
  const set =
    (k: "name" | "public_host" | "port" | "labels") => (e: React.ChangeEvent<HTMLInputElement>) =>
      onChange({ ...values, [k]: e.target.value });
  const def = profiles.find((p) => p.is_default);
  const turnSwitchId = React.useId();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(validateProvisionForm(values)).length > 0) return;
    onSubmit();
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      className="flex min-h-0 flex-1 flex-col"
      aria-label={t("install.steps.server")}
    >
      <DialogBody className="grid gap-4 sm:grid-cols-2">
        <Field label={t("install.name")} error={err("name")}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              autoFocus
              autoComplete="off"
              placeholder={t("wizard.namePlaceholder")}
              value={values.name}
              onChange={set("name")}
              aria-invalid={invalid}
              aria-describedby={describedBy}
            />
          )}
        </Field>
        <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-3">
          <Field
            label={t("install.publicHost")}
            error={err("public_host")}
            hint={t("install.publicHostHint")}
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                autoComplete="off"
                spellCheck={false}
                placeholder="203.0.113.10"
                className="font-mono"
                value={values.public_host}
                onChange={set("public_host")}
                aria-invalid={invalid}
                aria-describedby={describedBy}
              />
            )}
          </Field>
          <Field label={t("install.port")} error={err("port")}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                inputMode="numeric"
                autoComplete="off"
                className="font-mono tabular"
                value={values.port}
                onChange={set("port")}
                aria-invalid={invalid}
                aria-describedby={describedBy}
              />
            )}
          </Field>
        </div>

        <div className="flex flex-col gap-2 sm:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label>{t("install.backend")}</Label>
            <Segmented<Backend>
              value={values.backend}
              onChange={(backend) => onChange({ ...values, backend })}
              label={t("install.backend")}
              options={[
                {
                  value: "sled",
                  label: (
                    <>
                      <HardDrive aria-hidden />
                      {t("install.backendSled")}
                    </>
                  ),
                },
                {
                  value: "jetstream",
                  label: (
                    <>
                      <Database aria-hidden />
                      {t("install.backendJetstream")}
                    </>
                  ),
                },
              ]}
            />
          </div>
          <p className="text-xs text-fg-subtle">
            {values.backend === "sled"
              ? t("install.backendSledHint")
              : t("install.backendJetstreamHint")}
          </p>
        </div>

        <div className="flex flex-col gap-2 rounded-md border border-line bg-bg-elevated px-3.5 py-3 sm:col-span-2">
          <div className="flex items-center justify-between gap-4">
            <label
              htmlFor={turnSwitchId}
              className="flex items-center gap-2 text-sm font-medium text-fg"
            >
              <PhoneCall className="size-4 text-accent" aria-hidden />
              {t("install.withTurn")}
            </label>
            <Switch
              id={turnSwitchId}
              checked={values.with_turn}
              onCheckedChange={(with_turn) => onChange({ ...values, with_turn })}
            />
          </div>
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-fg-subtle">
            {t("install.withTurnHint")}
            {COTURN_PORTS.map((p) => (
              <code
                key={p}
                className="rounded-xs border border-line bg-surface-2 px-1.5 font-mono text-[11px] text-fg"
              >
                {p}
              </code>
            ))}
          </p>
        </div>

        <Field label={t("install.profile")}>
          {({ id }) => (
            <Select
              value={values.profile_id || DEFAULT}
              onValueChange={(v) => onChange({ ...values, profile_id: v === DEFAULT ? "" : v })}
            >
              <SelectTrigger id={id} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT}>
                  {t("install.profileDefault", { name: def?.name ?? "—" })}
                </SelectItem>
                {profiles
                  .filter((p) => !p.is_default)
                  .map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          )}
        </Field>
        <Field label={t("wizard.labels")} error={err("labels")} hint={t("nodeSettings.labelsHint")}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              autoComplete="off"
              placeholder={t("wizard.labelsPlaceholder")}
              className="font-mono"
              value={values.labels}
              onChange={set("labels")}
              aria-invalid={invalid}
              aria-describedby={describedBy}
            />
          )}
        </Field>

        <div className="flex flex-col gap-2 sm:col-span-2">
          <span className="text-[13px] font-medium text-fg">{t("install.turnServers")}</span>
          {turn.length === 0 ? (
            <p className="text-xs text-fg-subtle">{t("install.turnServersNone")}</p>
          ) : (
            <>
              <TurnPicker
                servers={turn}
                value={values.turn_server_ids}
                onChange={(turn_server_ids) => onChange({ ...values, turn_server_ids })}
                label={t("install.turnServers")}
              />
              <p className="text-xs text-fg-subtle">{t("install.turnServersHint")}</p>
            </>
          )}
        </div>

        {serverError && (
          <p
            role="alert"
            className="rounded-md border border-fail/30 bg-fail-soft px-3 py-2 text-sm text-fg sm:col-span-2"
          >
            {serverError}
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? t("install.creating") : t("install.create")}
        </Button>
      </DialogFooter>
    </form>
  );
}
