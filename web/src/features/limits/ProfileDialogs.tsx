import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
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
import { isValidName } from "@/features/nodes/validation";
import type { Profile } from "@/lib/types";

const NONE = "__none__";

/** «Новый профиль»: name and optionally the values of an existing profile to start from. */
interface CreateProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  profiles: Profile[];
  pending: boolean;
  serverError: string | null;
  onSubmit: (input: { name: string; settings: Record<string, number> }) => void;
}

export function CreateProfileDialog(props: CreateProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <CreateProfileForm {...props} />
      </DialogContent>
    </Dialog>
  );
}

/** Mounted with the dialog content, so its state starts fresh on every open. */
function CreateProfileForm({
  onOpenChange,
  profiles,
  pending,
  serverError,
  onSubmit,
}: CreateProps) {
  const { t } = useTranslation();
  const [name, setName] = React.useState("");
  const [from, setFrom] = React.useState(NONE);
  const [error, setError] = React.useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidName(name)) {
      setError(t("validation.name"));
      return;
    }
    const source = profiles.find((p) => p.id === from);
    onSubmit({ name: name.trim(), settings: { ...(source?.settings ?? {}) } });
  };

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogHeader>
        <DialogTitle>{t("profiles.createTitle")}</DialogTitle>
        <DialogDescription>{t("profiles.defaultExplainer")}</DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-4">
        <Field label={t("profiles.name")} error={error}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              autoFocus
              autoComplete="off"
              placeholder={t("profiles.namePlaceholder")}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              aria-invalid={invalid}
              aria-describedby={describedBy}
            />
          )}
        </Field>
        <Field label={t("profiles.copyFrom")}>
          {({ id }) => (
            <Select value={from} onValueChange={setFrom}>
              <SelectTrigger id={id} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("profiles.copyNone")}</SelectItem>
                {profiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {t("profiles.copyOf", { name: p.name })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>
        {serverError && (
          <p
            role="alert"
            className="rounded-md border border-fail/30 bg-fail-soft px-3 py-2 text-sm text-fg"
          >
            {serverError}
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? t("common.saving") : t("profiles.create")}
        </Button>
      </DialogFooter>
    </form>
  );
}

interface RenameProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  profile: Profile;
  pending: boolean;
  serverError: string | null;
  onSubmit: (name: string) => void;
}

export function RenameProfileDialog(props: RenameProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-md">
        <RenameProfileForm {...props} />
      </DialogContent>
    </Dialog>
  );
}

function RenameProfileForm({ onOpenChange, profile, pending, serverError, onSubmit }: RenameProps) {
  const { t } = useTranslation();
  const [name, setName] = React.useState(profile.name);
  const [error, setError] = React.useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidName(name)) {
      setError(t("validation.name"));
      return;
    }
    if (name.trim() === profile.name) {
      onOpenChange(false);
      return;
    }
    onSubmit(name.trim());
  };

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogHeader>
        <DialogTitle>{t("profiles.renameTitle")}</DialogTitle>
        <DialogDescription className="sr-only">{profile.name}</DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-4">
        <Field label={t("profiles.name")} error={error ?? serverError}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              autoFocus
              autoComplete="off"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              aria-invalid={invalid}
              aria-describedby={describedBy}
            />
          )}
        </Field>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? t("common.saving") : t("common.save")}
        </Button>
      </DialogFooter>
    </form>
  );
}
