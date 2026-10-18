import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { KeyRound, Link2Off, UserCheck } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast-store";
import { AuthLayout } from "@/features/auth/AuthLayout";
import { LoginForm } from "@/features/auth/LoginForm";
import { api, isApiError } from "@/lib/api";
import { safeNext } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { qk, setupQuery } from "@/lib/queries";
import type { User } from "@/lib/types";

function useSignedIn() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return (user: User, next = "/") => {
    qc.setQueryData(qk.me, user);
    qc.setQueryData(qk.setup, { needed: false });
    void navigate({ to: safeNext(next) });
  };
}

export function LoginPage({ next }: { next?: string }) {
  const { t } = useTranslation();
  const signedIn = useSignedIn();
  return (
    <AuthLayout title={t("auth.title")} subtitle={t("auth.subtitle")}>
      <LoginForm onSuccess={(u) => signedIn(u, next)} />
    </AuthLayout>
  );
}

function PasswordPair({
  password,
  confirm,
  onPassword,
  onConfirm,
  errors,
}: {
  password: string;
  confirm: string;
  onPassword: (v: string) => void;
  onConfirm: (v: string) => void;
  errors: { password?: string; confirm?: string };
}) {
  const { t } = useTranslation();
  return (
    <>
      <Field label={t("setup.password")} error={errors.password} hint={t("validation.passwordMin")}>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => onPassword(e.target.value)}
            aria-invalid={invalid}
            aria-describedby={describedBy}
          />
        )}
      </Field>
      <Field label={t("setup.passwordConfirm")} error={errors.confirm}>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => onConfirm(e.target.value)}
            aria-invalid={invalid}
            aria-describedby={describedBy}
          />
        )}
      </Field>
    </>
  );
}

function validatePasswords(password: string, confirm: string, t: (k: string) => string) {
  const errors: { password?: string; confirm?: string } = {};
  if ([...password].length < 10) errors.password = t("validation.passwordMin");
  if (password !== confirm) errors.confirm = t("validation.passwordMismatch");
  return errors;
}

export function SetupPage({ token: initialToken }: { token?: string }) {
  const { t } = useTranslation();
  const signedIn = useSignedIn();
  const state = useQuery(setupQuery);
  const [token, setToken] = React.useState(initialToken ?? "");
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [errors, setErrors] = React.useState<{
    password?: string;
    confirm?: string;
    username?: string;
    token?: string;
  }>({});

  const complete = useMutation({
    mutationFn: () =>
      api.setup.complete({ token: token.trim(), username: username.trim(), password }),
    onSuccess: (user) => {
      toast.success(t("setup.success"));
      signedIn(user);
    },
  });

  if (state.isPending) {
    return (
      <AuthLayout title={t("setup.title")}>
        <Skeleton className="h-40" />
      </AuthLayout>
    );
  }

  if (state.data && !state.data.needed) {
    return (
      <AuthLayout title={t("setup.notNeeded")} subtitle={t("setup.notNeededText")}>
        <Button asChild variant="primary" className="w-full">
          <Link to="/login">{t("setup.toLogin")}</Link>
        </Button>
      </AuthLayout>
    );
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: typeof errors = validatePasswords(password, confirm, t);
    const ulen = [...username.trim()].length;
    if (ulen < 1 || ulen > 64) errs.username = t("validation.username");
    if (!token.trim()) errs.token = t("setup.noToken");
    setErrors(errs);
    if (Object.keys(errs).length === 0) complete.mutate();
  };

  return (
    <AuthLayout title={t("setup.title")} subtitle={t("setup.subtitle")}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {!initialToken && (
          <Field label={t("setup.token")} error={errors.token}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                className="font-mono"
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                aria-invalid={invalid}
                aria-describedby={describedBy}
              />
            )}
          </Field>
        )}
        <Field label={t("setup.username")} error={errors.username}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              aria-invalid={invalid}
              aria-describedby={describedBy}
            />
          )}
        </Field>
        <PasswordPair
          password={password}
          confirm={confirm}
          onPassword={setPassword}
          onConfirm={setConfirm}
          errors={errors}
        />
        {complete.error && (
          <p
            role="alert"
            className="rounded-md border border-fail/30 bg-fail-soft px-3 py-2 text-sm text-fg"
          >
            {errorMessage(complete.error, t)}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" disabled={complete.isPending}>
          <KeyRound />
          {t("setup.submit")}
        </Button>
      </form>
    </AuthLayout>
  );
}

export function InvitePage({ token }: { token?: string }) {
  const { t } = useTranslation();
  const signedIn = useSignedIn();
  const info = useQuery({
    queryKey: ["invite", token],
    queryFn: () => api.invite.get(token ?? ""),
    enabled: Boolean(token),
    retry: false,
  });
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [errors, setErrors] = React.useState<{ password?: string; confirm?: string }>({});

  const accept = useMutation({
    mutationFn: () => api.invite.accept({ token: token ?? "", password }),
    onSuccess: (user) => {
      toast.success(t("invite.success"));
      signedIn(user);
    },
  });

  if (!token || info.isError) {
    return (
      <AuthLayout title={t("invite.invalid")} subtitle={t("invite.invalidText")}>
        <div className="flex flex-col items-center gap-4">
          <Link2Off className="size-8 text-fail" aria-hidden />
          {info.isError && !isApiError(info.error, "not_found") && (
            <p className="text-sm text-fg-muted">{errorMessage(info.error, t)}</p>
          )}
          <Button asChild variant="secondary" className="w-full">
            <Link to="/login">{t("setup.toLogin")}</Link>
          </Button>
        </div>
      </AuthLayout>
    );
  }

  if (info.isPending) {
    return (
      <AuthLayout title={t("invite.title")}>
        <Skeleton className="h-40" />
      </AuthLayout>
    );
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validatePasswords(password, confirm, t);
    setErrors(errs);
    if (Object.keys(errs).length === 0) accept.mutate();
  };

  return (
    <AuthLayout
      title={t("invite.title")}
      subtitle={t("invite.subtitle", { username: info.data.username })}
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <input type="text" autoComplete="username" value={info.data.username} hidden readOnly />
        <PasswordPair
          password={password}
          confirm={confirm}
          onPassword={setPassword}
          onConfirm={setConfirm}
          errors={errors}
        />
        {accept.error && (
          <p
            role="alert"
            className="rounded-md border border-fail/30 bg-fail-soft px-3 py-2 text-sm text-fg"
          >
            {errorMessage(accept.error, t)}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" disabled={accept.isPending}>
          <UserCheck />
          {t("invite.submit")}
        </Button>
      </form>
    </AuthLayout>
  );
}
