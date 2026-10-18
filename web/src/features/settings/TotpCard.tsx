import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, ShieldOff } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { CopyButton } from "@/components/CopyButton";
import { QrCode } from "@/components/QrCode";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast-store";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { qk } from "@/lib/queries";
import type { TotpSetup, User } from "@/lib/types";

const CODE_RE = /^\d{6}$/;

function CodeInput({
  value,
  onChange,
  id,
  describedBy,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  id: string;
  describedBy?: string;
  invalid: boolean;
}) {
  return (
    <Input
      id={id}
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={6}
      placeholder="000000"
      className="w-40 text-center font-mono text-lg tracking-[0.4em] tabular"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      aria-invalid={invalid}
      aria-describedby={describedBy}
    />
  );
}

export function TotpCard({ user }: { user: User }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [setup, setSetup] = React.useState<TotpSetup | null>(null);
  const [code, setCode] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [codeError, setCodeError] = React.useState<string | null>(null);

  const onUser = (u: User, msg: string) => {
    qc.setQueryData(qk.me, u);
    setSetup(null);
    setCode("");
    setPassword("");
    toast.success(msg);
  };

  const begin = useMutation({
    mutationFn: () => api.auth.totpSetup(),
    onSuccess: setSetup,
    onError: (e) => toast.error(errorMessage(e, t)),
  });
  const enable = useMutation({
    mutationFn: () => api.auth.totpEnable(code),
    onSuccess: (u) => onUser(u, t("profile.totp.enabled")),
  });
  const disable = useMutation({
    mutationFn: () => api.auth.totpDisable({ password, code }),
    onSuccess: (u) => onUser(u, t("profile.totp.disabled")),
  });

  const checkCode = () => {
    if (!CODE_RE.test(code)) {
      setCodeError(t("validation.totpCode"));
      return false;
    }
    setCodeError(null);
    return true;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("profile.totp.title")}</CardTitle>
        {user.totp_enabled ? (
          <ShieldCheck className="size-4 text-ok" aria-hidden />
        ) : (
          <ShieldOff className="size-4 text-fg-subtle" aria-hidden />
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-fg-muted">
          {user.totp_enabled ? t("profile.totp.on") : t("profile.totp.off")}
        </p>

        {!user.totp_enabled && !setup && (
          <Button
            variant="primary"
            className="self-start"
            disabled={begin.isPending}
            onClick={() => begin.mutate()}
          >
            <ShieldCheck />
            {t("profile.totp.enable")}
          </Button>
        )}

        {!user.totp_enabled && setup && (
          <form
            className="flex flex-col gap-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (checkCode()) enable.mutate();
            }}
          >
            <p className="text-sm text-fg">{t("profile.totp.scan")}</p>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <div className="w-44 shrink-0 rounded-lg border border-line-strong p-2 shadow-glow">
                <QrCode value={setup.otpauth_uri} label={t("profile.totp.qr")} className="w-full" />
              </div>
              <div className="flex min-w-0 flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-fg-subtle">{t("profile.totp.secret")}</span>
                  <span className="flex items-center gap-1">
                    <code className="font-mono text-sm break-all text-fg select-all">
                      {setup.secret.match(/.{1,4}/g)?.join(" ")}
                    </code>
                    <CopyButton value={setup.secret} toastTitle={t("common.copied")} />
                  </span>
                </div>
                <Field
                  label={t("profile.totp.code")}
                  error={codeError ?? (enable.error ? errorMessage(enable.error, t) : null)}
                >
                  {(f) => <CodeInput value={code} onChange={setCode} {...f} />}
                </Field>
                <div className="flex gap-2">
                  <Button type="submit" variant="primary" disabled={enable.isPending}>
                    {t("profile.totp.confirm")}
                  </Button>
                  <Button variant="ghost" onClick={() => setSetup(null)}>
                    {t("common.cancel")}
                  </Button>
                </div>
              </div>
            </div>
          </form>
        )}

        {user.totp_enabled && (
          <form
            className="flex flex-col gap-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (checkCode() && password) disable.mutate();
            }}
          >
            <p className="text-xs text-fg-subtle">{t("profile.totp.disableText")}</p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <Field label={t("auth.password")} className="sm:w-60">
                {({ id }) => (
                  <Input
                    id={id}
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                )}
              </Field>
              <Field label={t("profile.totp.code")} error={codeError}>
                {(f) => <CodeInput value={code} onChange={setCode} {...f} />}
              </Field>
            </div>
            {disable.error && (
              <p role="alert" className="text-sm text-fail">
                {errorMessage(disable.error, t)}
              </p>
            )}
            <Button
              type="submit"
              variant="danger-outline"
              className="self-start"
              disabled={disable.isPending || !password}
            >
              <ShieldOff />
              {t("profile.totp.disable")}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
