import { Fingerprint } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { DialogBody, DialogFooter } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { formatFingerprint } from "@/lib/format";
import type { CreateNodeInput } from "@/lib/types";
import {
  isValidNodeKey,
  normalizeNodeKey,
  parseLabels,
  validateNodeForm,
  type NodeFormErrors,
  type NodeFormValues,
} from "./validation";

interface NodeFormProps {
  values: NodeFormValues;
  onChange: (v: NodeFormValues) => void;
  onSubmit: (input: CreateNodeInput) => void;
  onCancel: () => void;
  pending: boolean;
  serverError: string | null;
  submitLabel: string;
}

/** Step 1 of the wizard: name, addr, pin, labels with client-side validation. */
export function NodeForm({
  values,
  onChange,
  onSubmit,
  onCancel,
  pending,
  serverError,
  submitLabel,
}: NodeFormProps) {
  const { t } = useTranslation();
  const [errors, setErrors] = React.useState<NodeFormErrors>({});
  const [touched, setTouched] = React.useState(false);

  const set = (k: keyof NodeFormValues) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = { ...values, [k]: e.target.value };
    onChange(next);
    if (touched) setErrors(validateNodeForm(next));
  };

  const key = normalizeNodeKey(values.node_key);
  const keyValid = isValidNodeKey(key);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    const errs = validateNodeForm(values);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    const labels = parseLabels(values.labels);
    onSubmit({
      name: values.name.trim(),
      addr: values.addr.trim(),
      node_key: key,
      labels: labels.ok ? labels.labels : {},
    });
  };

  const err = (k: keyof NodeFormValues) => (errors[k] ? t(errors[k]) : null);

  return (
    <form
      onSubmit={submit}
      noValidate
      className="flex min-h-0 flex-1 flex-col"
      aria-label={t("wizard.steps.address")}
    >
      <DialogBody className="grid gap-4 sm:grid-cols-2">
        <Field label={t("wizard.name")} error={err("name")}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              name="name"
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
        <Field label={t("wizard.addr")} error={err("addr")}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              name="addr"
              autoComplete="off"
              spellCheck={false}
              placeholder={t("wizard.addrPlaceholder")}
              className="font-mono"
              value={values.addr}
              onChange={set("addr")}
              aria-invalid={invalid}
              aria-describedby={describedBy}
            />
          )}
        </Field>
        <Field
          className="sm:col-span-2"
          label={t("wizard.nodeKey")}
          error={err("node_key")}
          hint={t("wizard.nodeKeyHint")}
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              name="node_key"
              autoComplete="off"
              spellCheck={false}
              placeholder={t("wizard.nodeKeyPlaceholder")}
              className="font-mono text-[13px]"
              value={values.node_key}
              onChange={set("node_key")}
              aria-invalid={invalid}
              aria-describedby={describedBy}
            />
          )}
        </Field>
        {keyValid && (
          <div className="flex items-center gap-2 rounded-md border border-accent/30 bg-accent-soft px-3 py-2 sm:col-span-2">
            <Fingerprint className="size-4 shrink-0 text-accent" aria-hidden />
            <span className="text-xs text-fg-muted">{t("wizard.fingerprint")}</span>
            <span
              className="min-w-0 font-mono text-xs break-all text-fg"
              data-testid="fingerprint-preview"
            >
              {formatFingerprint(key)}
            </span>
          </div>
        )}
        <Field
          className="sm:col-span-2"
          label={t("wizard.labels")}
          error={err("labels")}
          hint={t("nodeSettings.labelsHint")}
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              name="labels"
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
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
