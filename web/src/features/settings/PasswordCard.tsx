import { useMutation } from "@tanstack/react-query";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast-store";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";

export function PasswordCard() {
  const { t } = useTranslation();
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [errors, setErrors] = React.useState<{ next?: string; confirm?: string }>({});

  const change = useMutation({
    mutationFn: () => api.auth.changePassword({ current, new: next }),
    onSuccess: () => {
      toast.success(t("profile.password.changed"));
      setCurrent("");
      setNext("");
      setConfirm("");
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: typeof errors = {};
    if ([...next].length < 10) errs.next = t("validation.passwordMin");
    if (next !== confirm) errs.confirm = t("validation.passwordMismatch");
    setErrors(errs);
    if (Object.keys(errs).length === 0 && current) change.mutate();
  };

  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle>{t("profile.password.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <p className="text-sm text-fg-muted">{t("profile.password.text")}</p>
          <input type="text" autoComplete="username" hidden readOnly />
          <Field label={t("profile.password.current")}>
            {({ id }) => (
              <Input
                id={id}
                type="password"
                autoComplete="current-password"
                required
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            )}
          </Field>
          <Field
            label={t("profile.password.new")}
            error={errors.next}
            hint={t("validation.passwordMin")}
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                aria-invalid={invalid}
                aria-describedby={describedBy}
              />
            )}
          </Field>
          <Field label={t("profile.password.confirm")} error={errors.confirm}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                aria-invalid={invalid}
                aria-describedby={describedBy}
              />
            )}
          </Field>
          {change.error && (
            <p role="alert" className="text-sm text-fail">
              {errorMessage(change.error, t)}
            </p>
          )}
          <Button
            type="submit"
            variant="primary"
            className="self-start"
            disabled={change.isPending || !current}
          >
            {t("profile.password.submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
