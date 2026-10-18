import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, LogIn, ShieldCheck } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { api, isApiError } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import type { User } from "@/lib/types";

type Step = "password" | "totp";

/** Username + password; switches to a TOTP step when the server answers `totp_required`. */
export function LoginForm({ onSuccess }: { onSuccess: (user: User) => void }) {
  const { t } = useTranslation();
  const [step, setStep] = React.useState<Step>("password");
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [totp, setTotp] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const login = useMutation({
    mutationFn: (withTotp: boolean) =>
      api.auth.login({ username: username.trim(), password, ...(withTotp ? { totp } : {}) }),
    onSuccess,
    onError: (e, withTotp) => {
      if (isApiError(e, "totp_required")) {
        if (withTotp) {
          setError(t("auth.invalidTotp"));
          setTotp("");
        } else {
          setError(null);
          setStep("totp");
        }
        return;
      }
      if (isApiError(e, "unauthorized")) {
        setError(t("auth.invalidCredentials"));
        if (withTotp) setStep("password");
        return;
      }
      setError(errorMessage(e, t));
    },
  });

  const submitPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError(t("validation.required"));
      return;
    }
    setError(null);
    login.mutate(false);
  };

  const submitTotp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(totp)) {
      setError(t("validation.totpCode"));
      return;
    }
    setError(null);
    login.mutate(true);
  };

  return (
    <AnimatePresence mode="wait" initial={false}>
      {step === "password" ? (
        <motion.form
          key="password"
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -10 }}
          onSubmit={submitPassword}
          noValidate
          className="flex flex-col gap-4"
          aria-label={t("auth.title")}
        >
          <Field label={t("auth.username")}>
            {({ id }) => (
              <Input
                id={id}
                name="username"
                autoComplete="username"
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            )}
          </Field>
          <Field label={t("auth.password")}>
            {({ id }) => (
              <Input
                id={id}
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
          {error && (
            <p
              role="alert"
              className="rounded-md border border-fail/30 bg-fail-soft px-3 py-2 text-sm text-fg"
            >
              {error}
            </p>
          )}
          <Button
            type="submit"
            variant="primary"
            size="lg"
            disabled={login.isPending}
            className="mt-1"
          >
            <LogIn />
            {login.isPending ? t("auth.submitting") : t("auth.submit")}
          </Button>
        </motion.form>
      ) : (
        <motion.form
          key="totp"
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 10 }}
          onSubmit={submitTotp}
          noValidate
          className="flex flex-col gap-4"
          aria-label={t("auth.totpTitle")}
        >
          <div className="flex items-start gap-3 rounded-md border border-accent/30 bg-accent-soft p-3">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
            <div>
              <p className="text-sm font-medium text-fg">{t("auth.totpTitle")}</p>
              <p className="text-xs text-fg-muted">{t("auth.totpSubtitle")}</p>
            </div>
          </div>
          <Field label={t("auth.totpCode")}>
            {({ id }) => (
              <Input
                id={id}
                name="totp"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={6}
                placeholder="000000"
                className="h-12 text-center font-mono text-2xl tracking-[0.5em] tabular"
                value={totp}
                onChange={(e) => setTotp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              />
            )}
          </Field>
          {error && (
            <p
              role="alert"
              className="rounded-md border border-fail/30 bg-fail-soft px-3 py-2 text-sm text-fg"
            >
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" size="lg" disabled={login.isPending}>
            {t("auth.verify")}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setStep("password");
              setTotp("");
              setError(null);
            }}
          >
            <ArrowLeft />
            {t("auth.backToPassword")}
          </Button>
        </motion.form>
      )}
    </AnimatePresence>
  );
}
