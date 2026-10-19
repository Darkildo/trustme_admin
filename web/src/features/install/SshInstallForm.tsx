import { ChevronRight, KeyRound, ShieldCheck, TerminalSquare, TriangleAlert } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";
import {
  validateSshForm,
  type SshAuth,
  type SshFormErrors,
  type SshFormValues,
} from "./validation";

/**
 * One-time SSH credentials for «Установить по SSH». Nothing here is persisted: the parent
 * keeps the values in memory and clears the secrets once the job starts.
 */
export function SshInstallForm({
  values,
  onChange,
  onSubmit,
  pending,
  serverError,
  showReissueNote,
}: {
  values: SshFormValues;
  onChange: (v: SshFormValues) => void;
  onSubmit: () => void;
  pending: boolean;
  serverError: string | null;
  showReissueNote: boolean;
}) {
  const { t } = useTranslation();
  const [touched, setTouched] = React.useState(false);
  const errors: SshFormErrors = touched ? validateSshForm(values) : {};
  const err = (k: keyof SshFormErrors) => (errors[k] ? t(errors[k]) : null);
  const set =
    (k: keyof SshFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange({ ...values, [k]: e.target.value });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(validateSshForm(values)).length > 0) return;
    onSubmit();
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      className="flex flex-col gap-4"
      aria-label={t("install.methodSsh")}
    >
      <p className="text-sm text-fg-muted">{t("install.ssh.intro")}</p>
      <div className="flex items-start gap-2.5 rounded-md border border-ok/30 bg-ok-soft px-3 py-2.5 text-sm text-fg">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
        <span>{t("install.ssh.noStore")}</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_120px]">
        <Field label={t("install.ssh.host")} error={err("host")}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
              value={values.host}
              onChange={set("host")}
              aria-invalid={invalid}
              aria-describedby={describedBy}
            />
          )}
        </Field>
        <Field label={t("install.ssh.port")} error={err("port")}>
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
        <Field className="sm:col-span-2" label={t("install.ssh.username")} error={err("username")}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
              value={values.username}
              onChange={set("username")}
              aria-invalid={invalid}
              aria-describedby={describedBy}
            />
          )}
        </Field>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label>{t("install.ssh.auth")}</Label>
        <Segmented<SshAuth>
          value={values.auth}
          onChange={(auth) => onChange({ ...values, auth })}
          label={t("install.ssh.auth")}
          options={[
            {
              value: "password",
              label: (
                <>
                  <TerminalSquare aria-hidden />
                  {t("install.ssh.authPassword")}
                </>
              ),
            },
            {
              value: "key",
              label: (
                <>
                  <KeyRound aria-hidden />
                  {t("install.ssh.authKey")}
                </>
              ),
            },
          ]}
        />
      </div>

      {values.auth === "password" ? (
        <Field label={t("install.ssh.password")} error={err("password")}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="password"
              autoComplete="off"
              value={values.password}
              onChange={set("password")}
              aria-invalid={invalid}
              aria-describedby={describedBy}
            />
          )}
        </Field>
      ) : (
        <div className="grid gap-4">
          <Field
            label={t("install.ssh.privateKey")}
            hint={t("install.ssh.privateKeyHint")}
            error={err("private_key")}
          >
            {({ id, describedBy, invalid }) => (
              <Textarea
                id={id}
                rows={5}
                spellCheck={false}
                autoComplete="off"
                placeholder={
                  "-----BEGIN OPENSSH PRIVATE KEY-----\n…\n-----END OPENSSH PRIVATE KEY-----"
                }
                className="font-mono text-[12px] leading-snug"
                value={values.private_key}
                onChange={set("private_key")}
                aria-invalid={invalid}
                aria-describedby={describedBy}
              />
            )}
          </Field>
          <Field label={t("install.ssh.passphrase")} hint={t("install.ssh.passphraseHint")}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                type="password"
                autoComplete="off"
                value={values.passphrase}
                onChange={set("passphrase")}
                aria-describedby={describedBy}
              />
            )}
          </Field>
        </div>
      )}

      <Field label={t("install.ssh.sudoPassword")} hint={t("install.ssh.sudoPasswordHint")}>
        {({ id, describedBy }) => (
          <Input
            id={id}
            type="password"
            autoComplete="off"
            value={values.sudo_password}
            onChange={set("sudo_password")}
            aria-describedby={describedBy}
          />
        )}
      </Field>

      <details className="group rounded-md border border-line bg-bg-elevated/60 open:pb-3">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md px-3 py-2 text-[13px] font-medium text-fg-muted select-none hover:text-fg [&::-webkit-details-marker]:hidden">
          <ChevronRight
            className="size-3.5 transition-transform group-open:rotate-90"
            aria-hidden
          />
          {t("install.ssh.advanced")}
        </summary>
        <div className="px-3">
          <Field
            label={t("install.ssh.fingerprint")}
            hint={t("install.ssh.fingerprintHint")}
            error={err("host_fingerprint")}
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                autoComplete="off"
                spellCheck={false}
                placeholder="SHA256:…"
                className="font-mono text-[13px]"
                value={values.host_fingerprint}
                onChange={set("host_fingerprint")}
                aria-invalid={invalid}
                aria-describedby={describedBy}
              />
            )}
          </Field>
        </div>
      </details>

      {showReissueNote && (
        <p className="flex items-start gap-2 text-xs text-fg-subtle">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden />
          {t("install.ssh.reissueNote")}
        </p>
      )}

      {serverError && (
        <p
          role="alert"
          className="rounded-md border border-fail/30 bg-fail-soft px-3 py-2 text-sm break-words text-fg"
        >
          {serverError}
        </p>
      )}

      {/* Прилипает к низу DialogBody: форма длиннее диалога, а главное действие должно быть видно. */}
      <div className="sticky -bottom-4 -mx-5 -mb-4 flex justify-end border-t border-line bg-surface-1 px-5 py-3">
        <Button type="submit" variant="primary" disabled={pending}>
          <TerminalSquare />
          {pending ? t("install.ssh.submitting") : t("install.ssh.submit")}
        </Button>
      </div>
    </form>
  );
}
