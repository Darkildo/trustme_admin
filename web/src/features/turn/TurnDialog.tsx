import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, KeyRound, Plus, ShieldCheck, Sparkles, TriangleAlert, X } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";
import { toast } from "@/components/ui/toast-store";
import { Tooltip } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { qk } from "@/lib/queries";
import type { TurnServer } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  generateSecret,
  hasTurnErrors,
  MAX_TURN_URLS,
  TURN_SCHEMES,
  turnPayload,
  validateTurnForm,
  type SecretMode,
  type TurnFormValues,
} from "./validation";

function initial(server: TurnServer | undefined): TurnFormValues {
  return {
    name: server?.name ?? "",
    urls: server ? [...server.urls] : [""],
    secretMode: "keep",
    secret: "",
  };
}

function TurnForm({ server, onDone }: { server: TurnServer | undefined; onDone: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [values, setValues] = React.useState<TurnFormValues>(() => initial(server));
  const [touched, setTouched] = React.useState(false);
  const [showSecret, setShowSecret] = React.useState(false);
  const [activeRow, setActiveRow] = React.useState(0);
  const inputs = React.useRef<Array<HTMLInputElement | null>>([]);
  const hadSecret = server?.has_secret ?? false;
  const errors = validateTurnForm(values, hadSecret);
  const shown = touched ? errors : {};

  const save = useMutation({
    mutationFn: () => {
      const body = turnPayload(values);
      return server ? api.turn.update(server.id, body) : api.turn.create(body);
    },
    onSuccess: (s) => {
      void qc.invalidateQueries({ queryKey: qk.turn });
      void qc.invalidateQueries({
        predicate: (q) => q.queryKey[0] === "nodes" && q.queryKey[2] === "runtime",
      });
      toast.success(server ? t("turn.saved") : t("turn.created", { name: s.name }));
      onDone();
    },
  });

  const setUrl = (i: number, v: string) =>
    setValues((s) => ({ ...s, urls: s.urls.map((u, j) => (j === i ? v : u)) }));
  const addUrl = () => {
    setValues((s) => ({ ...s, urls: [...s.urls, ""] }));
    setActiveRow(values.urls.length);
    window.setTimeout(() => inputs.current[values.urls.length]?.focus(), 0);
  };
  const removeUrl = (i: number) => {
    setValues((s) => ({ ...s, urls: s.urls.filter((_, j) => j !== i) }));
    setActiveRow((r) => Math.max(0, Math.min(r, values.urls.length - 2)));
  };
  const insertScheme = (scheme: string) => {
    const i = Math.min(activeRow, values.urls.length - 1);
    const current = values.urls[i] ?? "";
    setUrl(i, scheme + current.replace(/^(stuns?|turns?):/i, ""));
    window.setTimeout(() => {
      const el = inputs.current[i];
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    }, 0);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (hasTurnErrors(errors)) return;
    save.mutate();
  };

  const modes: Array<{ value: SecretMode; label: string }> = hadSecret
    ? [
        { value: "keep", label: t("turn.secretKeep") },
        { value: "set", label: t("turn.secretSet") },
        { value: "remove", label: t("turn.secretRemove") },
      ]
    : [
        { value: "keep", label: t("turn.secretNone") },
        { value: "set", label: t("turn.secretSet") },
      ];

  const listHintId = React.useId();

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogHeader>
        <DialogTitle>
          {server ? t("turn.editTitle", { name: server.name }) : t("turn.addTitle")}
        </DialogTitle>
        <DialogDescription>{t("turn.subtitle")}</DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-5">
        <Field label={t("turn.name")} error={shown.name ? t(shown.name) : null}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              autoFocus
              autoComplete="off"
              placeholder={t("turn.namePlaceholder")}
              value={values.name}
              onChange={(e) => setValues((s) => ({ ...s, name: e.target.value }))}
              aria-invalid={invalid}
              aria-describedby={describedBy}
            />
          )}
        </Field>

        <fieldset className="flex flex-col gap-2" aria-describedby={listHintId}>
          <legend className="mb-1.5 text-[13px] font-medium text-fg">{t("turn.urls")}</legend>
          <div className="flex flex-wrap gap-1.5">
            {TURN_SCHEMES.map((scheme) => (
              <Tooltip key={scheme} content={t(`turn.schemes.${scheme.slice(0, -1)}`)}>
                <button
                  type="button"
                  onClick={() => insertScheme(scheme)}
                  aria-label={t("turn.insertScheme", { scheme })}
                  className={cn(
                    "inline-flex h-6 items-center rounded-full border px-2 font-mono text-[11px] transition-colors hover:text-fg",
                    scheme.startsWith("turn")
                      ? "border-accent/35 bg-accent-soft text-accent"
                      : "border-line-strong bg-surface-2 text-fg-muted",
                  )}
                >
                  {scheme}
                </button>
              </Tooltip>
            ))}
          </div>
          <ul className="flex flex-col gap-2">
            {values.urls.map((url, i) => {
              const err = shown.urls?.[i];
              const errId = `${listHintId}-e${i}`;
              return (
                <li key={i} className="flex flex-col gap-1">
                  <div className="flex items-center gap-1.5">
                    <Input
                      ref={(el) => {
                        inputs.current[i] = el;
                      }}
                      value={url}
                      onFocus={() => setActiveRow(i)}
                      onChange={(e) => setUrl(i, e.target.value)}
                      placeholder="turn:turn.example.org:3478?transport=udp"
                      aria-label={t("turn.urlLabel", { n: i + 1 })}
                      aria-invalid={Boolean(err)}
                      aria-describedby={err ? errId : undefined}
                      autoComplete="off"
                      spellCheck={false}
                      className="font-mono text-[13px]"
                    />
                    {values.urls.length > 1 && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => removeUrl(i)}
                        aria-label={t("turn.removeUrl", { n: i + 1 })}
                      >
                        <X />
                      </Button>
                    )}
                  </div>
                  {err && (
                    <p id={errId} role="alert" className="text-xs text-fail">
                      {t(err)}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p id={listHintId} className="text-xs text-fg-subtle">
              {shown.list ? <span className="text-fail">{t(shown.list)}</span> : t("turn.urlsHint")}
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={addUrl}
              disabled={values.urls.length >= MAX_TURN_URLS}
            >
              <Plus />
              {t("turn.addUrl")}
            </Button>
          </div>
        </fieldset>

        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label className="flex items-center gap-1.5">
              <KeyRound className="size-3.5 text-accent" aria-hidden />
              {t("turn.secret")}
            </Label>
            <Segmented<SecretMode>
              value={values.secretMode}
              onChange={(m) => setValues((s) => ({ ...s, secretMode: m }))}
              options={modes}
              label={t("turn.secretMode")}
            />
          </div>
          {values.secretMode === "keep" && hadSecret && (
            <p className="flex items-start gap-2 rounded-md border border-line bg-bg-elevated px-3 py-2 text-xs text-fg-muted">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-ok" aria-hidden />
              {t("turn.secretWriteOnly")}
            </p>
          )}
          {values.secretMode === "remove" && (
            <p className="flex items-start gap-2 rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-fg">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden />
              {t("turn.secretRemoveNote")}
            </p>
          )}
          {values.secretMode === "set" && (
            <Field
              label={<span className="sr-only">{t("turn.secret")}</span>}
              hint={t("turn.secretHint")}
              error={shown.secret ? t(shown.secret) : null}
            >
              {({ id, describedBy, invalid }) => (
                <div className="flex items-center gap-1.5">
                  <div className="relative min-w-0 flex-1">
                    <Input
                      id={id}
                      type={showSecret ? "text" : "password"}
                      autoComplete="new-password"
                      spellCheck={false}
                      value={values.secret}
                      onChange={(e) => setValues((s) => ({ ...s, secret: e.target.value }))}
                      aria-invalid={invalid}
                      aria-describedby={describedBy}
                      className="pr-10 font-mono text-[13px]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecret((v) => !v)}
                      aria-label={showSecret ? t("turn.hideSecret") : t("turn.showSecret")}
                      aria-pressed={showSecret}
                      className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-sm p-1 text-fg-subtle hover:text-fg"
                    >
                      {showSecret ? (
                        <EyeOff className="size-4" aria-hidden />
                      ) : (
                        <Eye className="size-4" aria-hidden />
                      )}
                    </button>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setValues((s) => ({ ...s, secret: generateSecret() }));
                      setShowSecret(true);
                    }}
                  >
                    <Sparkles />
                    {t("turn.generate")}
                  </Button>
                </div>
              )}
            </Field>
          )}
          {values.secretMode !== "set" && shown.secret && (
            <p role="alert" className="text-xs text-fail">
              {t(shown.secret)}
            </p>
          )}
        </div>

        {save.error && (
          <p
            role="alert"
            className="rounded-md border border-fail/30 bg-fail-soft px-3 py-2 text-sm break-words text-fg"
          >
            {errorMessage(save.error, t)}
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onDone}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" variant="primary" disabled={save.isPending}>
          {save.isPending ? t("common.saving") : t("common.save")}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Add or edit a STUN/TURN server. The secret is write-only: kept, replaced or removed. */
export function TurnDialog({
  open,
  onOpenChange,
  server,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  server?: TurnServer;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <TurnForm server={server} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
