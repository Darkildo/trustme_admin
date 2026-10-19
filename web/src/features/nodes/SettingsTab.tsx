import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useCan } from "@/app/useCurrentUser";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast-store";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { qk } from "@/lib/queries";
import type { NodeDetail, UpdateNodeInput } from "@/lib/types";
import {
  formatLabels,
  isValidAddr,
  isValidInterval,
  isValidName,
  isValidNodeKey,
  normalizeNodeKey,
  parseLabels,
} from "./validation";

interface FormState {
  name: string;
  addr: string;
  node_key: string;
  labels: string;
  notes: string;
  interval: string;
  paused: boolean;
}

function fromNode(n: NodeDetail): FormState {
  return {
    name: n.name,
    addr: n.addr,
    node_key: n.node_key,
    labels: formatLabels(n.labels),
    notes: n.notes,
    interval: String(n.probe_interval_secs),
    paused: n.paused,
  };
}

export function SettingsTab({ node }: { node: NodeDetail }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const canEdit = useCan("admin");
  const [form, setForm] = React.useState<FormState>(() => fromNode(node));
  const [errors, setErrors] = React.useState<Partial<Record<keyof FormState, string>>>({});
  const [confirmName, setConfirmName] = React.useState("");

  const save = useMutation({
    mutationFn: (input: UpdateNodeInput) => api.nodes.update(node.id, input),
    onSuccess: (updated) => {
      qc.setQueryData(qk.node(node.id), updated);
      void qc.invalidateQueries({ queryKey: qk.nodes, exact: true });
      void qc.invalidateQueries({ queryKey: qk.overview });
      setForm(fromNode(updated));
      toast.success(t("nodeSettings.saved"));
    },
    onError: (e) => toast.error(errorMessage(e, t)),
  });

  const remove = useMutation({
    mutationFn: () => api.nodes.remove(node.id),
    onSuccess: () => {
      qc.removeQueries({ queryKey: qk.node(node.id) });
      void qc.invalidateQueries({ queryKey: qk.nodes, exact: true });
      void qc.invalidateQueries({ queryKey: qk.overview });
      toast.success(t("nodeSettings.deleted", { name: node.name }));
      void navigate({ to: "/nodes" });
    },
    onError: (e) => toast.error(errorMessage(e, t)),
  });

  const set =
    (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!isValidName(form.name)) errs.name = t("validation.name");
    if (!isValidAddr(form.addr.trim())) errs.addr = t("validation.addr");
    const key = normalizeNodeKey(form.node_key);
    // A provisioned node gets its key from the agent; an empty key may stay empty.
    const keyPending = node.provisioning && key === "" && node.node_key === "";
    if (!keyPending && !isValidNodeKey(key)) errs.node_key = t("validation.nodeKey");
    const labels = parseLabels(form.labels);
    if (!labels.ok) errs.labels = t("validation.labels");
    const interval = Number(form.interval);
    if (!isValidInterval(interval)) errs.interval = t("validation.interval");
    setErrors(errs);
    if (Object.keys(errs).length > 0 || !labels.ok) return;

    const patch: UpdateNodeInput = {};
    if (form.name.trim() !== node.name) patch.name = form.name.trim();
    if (form.addr.trim() !== node.addr) patch.addr = form.addr.trim();
    if (key !== node.node_key) patch.node_key = key;
    if (JSON.stringify(labels.labels) !== JSON.stringify(node.labels)) patch.labels = labels.labels;
    if (form.notes !== node.notes) patch.notes = form.notes;
    if (interval !== node.probe_interval_secs) patch.probe_interval_secs = interval;
    if (form.paused !== node.paused) patch.paused = form.paused;
    if (Object.keys(patch).length === 0) {
      toast.info(t("nodeSettings.saved"));
      return;
    }
    save.mutate(patch);
  };

  const ro = !canEdit;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("nodeSettings.title")}</CardTitle>
          {ro && <span className="text-xs text-fg-subtle">{t("common.readOnly")}</span>}
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} noValidate className="grid gap-4 md:grid-cols-2">
            <Field label={t("nodeSettings.name")} error={errors.name}>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  value={form.name}
                  onChange={set("name")}
                  readOnly={ro}
                  aria-invalid={invalid}
                  aria-describedby={describedBy}
                />
              )}
            </Field>
            <Field label={t("nodeSettings.addr")} error={errors.addr}>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  className="font-mono"
                  spellCheck={false}
                  value={form.addr}
                  onChange={set("addr")}
                  readOnly={ro}
                  aria-invalid={invalid}
                  aria-describedby={describedBy}
                />
              )}
            </Field>
            <Field
              className="md:col-span-2"
              label={t("nodeSettings.nodeKey")}
              error={errors.node_key}
            >
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  placeholder={node.provisioning ? t("node.pinPending") : undefined}
                  className="font-mono text-[13px]"
                  spellCheck={false}
                  value={form.node_key}
                  onChange={set("node_key")}
                  readOnly={ro}
                  aria-invalid={invalid}
                  aria-describedby={describedBy}
                />
              )}
            </Field>
            <Field
              label={t("nodeSettings.labels")}
              error={errors.labels}
              hint={t("nodeSettings.labelsHint")}
            >
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  className="font-mono"
                  value={form.labels}
                  onChange={set("labels")}
                  readOnly={ro}
                  aria-invalid={invalid}
                  aria-describedby={describedBy}
                />
              )}
            </Field>
            <Field
              label={t("nodeSettings.interval")}
              error={errors.interval}
              hint={t("nodeSettings.intervalHint")}
            >
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  type="number"
                  inputMode="numeric"
                  min={15}
                  max={3600}
                  className="font-mono tabular"
                  value={form.interval}
                  onChange={set("interval")}
                  readOnly={ro}
                  aria-invalid={invalid}
                  aria-describedby={describedBy}
                />
              )}
            </Field>
            <Field className="md:col-span-2" label={t("nodeSettings.notes")}>
              {({ id }) => (
                <Textarea
                  id={id}
                  value={form.notes}
                  onChange={set("notes")}
                  readOnly={ro}
                  rows={3}
                />
              )}
            </Field>
            <div className="flex items-center justify-between gap-4 rounded-md border border-line bg-bg-elevated px-3.5 py-3 md:col-span-2">
              <div>
                <label htmlFor="node-paused" className="text-sm font-medium text-fg">
                  {t("nodeSettings.paused")}
                </label>
                <p className="text-xs text-fg-subtle">{t("nodeSettings.pausedHint")}</p>
              </div>
              <Switch
                id="node-paused"
                checked={form.paused}
                disabled={ro}
                onCheckedChange={(v) => setForm((f) => ({ ...f, paused: v }))}
              />
            </div>
            {canEdit && (
              <div className="flex justify-end gap-2 md:col-span-2">
                <Button variant="ghost" onClick={() => setForm(fromNode(node))}>
                  {t("common.cancel")}
                </Button>
                <Button type="submit" variant="primary" disabled={save.isPending}>
                  {save.isPending ? t("common.saving") : t("common.save")}
                </Button>
              </div>
            )}
          </form>
        </CardContent>
      </Card>

      {canEdit && (
        <Card className="border-fail/30">
          <CardHeader>
            <CardTitle className="text-fail">{t("nodeSettings.danger")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-fg">{t("nodeSettings.deleteTitle")}</p>
              <p className="text-sm text-fg-muted">{t("nodeSettings.deleteText")}</p>
            </div>
            <AlertDialog onOpenChange={() => setConfirmName("")}>
              <AlertDialogTrigger asChild>
                <Button variant="danger-outline">
                  <Trash2 />
                  {t("nodeSettings.deleteTitle")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogTitle>{t("nodeSettings.deleteTitle")}</AlertDialogTitle>
                <AlertDialogDescription>{t("nodeSettings.deleteText")}</AlertDialogDescription>
                <Field label={t("nodeSettings.deleteConfirmLabel", { name: node.name })}>
                  {({ id }) => (
                    <Input
                      id={id}
                      autoComplete="off"
                      className="font-mono"
                      value={confirmName}
                      onChange={(e) => setConfirmName(e.target.value)}
                    />
                  )}
                </Field>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                  <Button
                    variant="danger"
                    disabled={confirmName !== node.name || remove.isPending}
                    onClick={() => remove.mutate()}
                  >
                    <Trash2 />
                    {t("nodeSettings.deleteButton")}
                  </Button>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
