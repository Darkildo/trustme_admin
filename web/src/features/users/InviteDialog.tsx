import { useMutation, useQueryClient } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { SecretOnce } from "@/components/SecretOnce";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { qk } from "@/lib/queries";
import type { Role } from "@/lib/types";

const ROLES: Role[] = ["viewer", "admin", "owner"];

export function InviteDialog() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [username, setUsername] = React.useState("");
  const [role, setRole] = React.useState<Role>("viewer");
  const [error, setError] = React.useState<string | null>(null);
  const [link, setLink] = React.useState<string | null>(null);

  const invite = useMutation({
    mutationFn: () => api.users.invite({ username: username.trim(), role }),
    onSuccess: (res) => {
      setLink(new URL(res.invite_url, window.location.origin).toString());
      void qc.invalidateQueries({ queryKey: qk.users });
    },
  });

  const onOpenChange = (o: boolean) => {
    setOpen(o);
    if (!o) {
      window.setTimeout(() => {
        setUsername("");
        setRole("viewer");
        setLink(null);
        setError(null);
        invite.reset();
      }, 250);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const len = [...username.trim()].length;
    if (len < 1 || len > 64) {
      setError(t("validation.username"));
      return;
    }
    setError(null);
    invite.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="primary">
          <UserPlus />
          {t("users.invite")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("users.inviteTitle")}</DialogTitle>
          <DialogDescription>{t("users.inviteText")}</DialogDescription>
        </DialogHeader>
        {link ? (
          <>
            <DialogBody>
              <SecretOnce
                label={t("users.inviteLink")}
                value={link}
                warning={t("users.inviteOnce")}
              />
            </DialogBody>
            <DialogFooter>
              <Button variant="primary" onClick={() => onOpenChange(false)}>
                {t("common.done")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} noValidate>
            <DialogBody className="flex flex-col gap-4">
              <Field label={t("users.username")} error={error}>
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    autoFocus
                    autoComplete="off"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    aria-invalid={invalid}
                    aria-describedby={describedBy}
                  />
                )}
              </Field>
              <Field label={t("users.role")} hint={t(`users.roleHints.${role}`)}>
                {({ id, describedBy }) => (
                  <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                    <SelectTrigger id={id} aria-describedby={describedBy}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => (
                        <SelectItem key={r} value={r}>
                          {t(`users.roles.${r}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>
              {invite.error && (
                <p
                  role="alert"
                  className="rounded-md border border-fail/30 bg-fail-soft px-3 py-2 text-sm text-fg"
                >
                  {errorMessage(invite.error, t)}
                </p>
              )}
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="primary" disabled={invite.isPending}>
                {t("users.inviteSubmit")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
