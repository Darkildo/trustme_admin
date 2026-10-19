import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  KeyRound,
  Lock,
  LockOpen,
  Pencil,
  PhoneCall,
  Plus,
  RefreshCcw,
  Server,
  Trash2,
  Waypoints,
} from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useCan } from "@/app/useCurrentUser";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast-store";
import { Tooltip } from "@/components/ui/tooltip";
import { formatSettingValue } from "@/features/limits/units";
import { TurnDialog } from "@/features/turn/TurnDialog";
import { UrlChip } from "@/features/turn/UrlChip";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { catalogQuery, profilesQuery, qk, turnServersQuery } from "@/lib/queries";
import type { TurnServer } from "@/lib/types";

const TTL_KEY = "ice_credential_ttl_secs";
const TTL_FALLBACK = 7200;

function HowItWorks() {
  const { t, i18n } = useTranslation();
  const catalog = useQuery(catalogQuery).data;
  const profiles = useQuery(profilesQuery).data;
  const setting = catalog?.find((s) => s.key === TTL_KEY);
  const ttl =
    profiles?.find((p) => p.is_default)?.settings[TTL_KEY] ?? setting?.default ?? TTL_FALLBACK;
  const ttlText = formatSettingValue(
    ttl,
    { unit: "seconds", zero_unlimited: false },
    t,
    i18n.language,
  );
  const steps = [
    { icon: Waypoints, text: t("turn.how1") },
    { icon: KeyRound, text: t("turn.how2", { ttl: ttlText }) },
    { icon: RefreshCcw, text: t("turn.how3") },
    { icon: Server, text: t("turn.how4") },
  ];
  return (
    <Card className="relative h-fit overflow-hidden">
      <div aria-hidden className="absolute inset-0 bg-gradient-soft opacity-60" />
      <CardHeader className="relative">
        <CardTitle>{t("turn.howTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="relative">
        <ol className="flex flex-col gap-3">
          {steps.map(({ icon: Icon, text }, i) => (
            <li key={i} className="flex items-start gap-3 text-sm text-fg-muted">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-2 ring-1 ring-line-strong">
                <Icon className="size-3.5 text-accent" aria-hidden />
              </span>
              <span className="pt-1">{text}</span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

function ServerCard({
  server,
  canEdit,
  onEdit,
  onDelete,
}: {
  server: TurnServer;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const managed = server.managed_by_node;
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-line bg-surface-1 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h3 className="truncate font-medium text-fg">{server.name}</h3>
          <div className="flex flex-wrap items-center gap-1.5">
            {server.has_secret ? (
              <span className="inline-flex h-5 items-center gap-1 rounded-full border border-ok/30 bg-ok-soft px-2 text-[11px] font-medium text-ok">
                <Lock className="size-3" aria-hidden />
                {t("turn.hasSecret")}
              </span>
            ) : (
              <span className="inline-flex h-5 items-center gap-1 rounded-full border border-line-strong bg-surface-2 px-2 text-[11px] font-medium text-fg-muted">
                <LockOpen className="size-3" aria-hidden />
                {t("turn.noSecret")}
              </span>
            )}
            {managed && (
              <Tooltip content={t("turn.managedHint")}>
                <Link
                  to="/nodes/$id"
                  params={{ id: managed.id }}
                  className="inline-flex h-5 items-center gap-1 rounded-full border border-accent-2/40 bg-accent-2/10 px-2 text-[11px] font-medium text-accent-2 hover:underline"
                >
                  <Server className="size-3" aria-hidden />
                  {t("turn.managed", { name: managed.name })}
                </Link>
              </Tooltip>
            )}
          </div>
        </div>
        {canEdit && (
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onEdit}
              aria-label={t("turn.editAria", { name: server.name })}
            >
              <Pencil />
            </Button>
            {managed ? (
              <Tooltip content={t("turn.deleteManaged")}>
                <span tabIndex={0} className="rounded-sm" aria-label={t("turn.deleteManaged")}>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled
                    aria-hidden
                    tabIndex={-1}
                    className="pointer-events-none"
                  >
                    <Trash2 />
                  </Button>
                </span>
              </Tooltip>
            ) : (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onDelete}
                aria-label={t("turn.deleteAria", { name: server.name })}
                className="hover:text-fail"
              >
                <Trash2 />
              </Button>
            )}
          </div>
        )}
      </div>
      <ul className="flex flex-wrap gap-1.5" aria-label={t("turn.urls")}>
        {server.urls.map((u) => (
          <li key={u} className="min-w-0">
            <UrlChip url={u} />
          </li>
        ))}
      </ul>
      <p className="mt-auto flex items-center gap-1.5 text-xs text-fg-subtle tabular">
        <PhoneCall className="size-3" aria-hidden />
        {server.nodes > 0 ? t("common.nodes", { count: server.nodes }) : t("turn.noNodes")}
      </p>
    </li>
  );
}

export function TurnPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const canEdit = useCan("admin");
  const q = useQuery(turnServersQuery);
  const [dialog, setDialog] = React.useState<{ open: boolean; server?: TurnServer }>({
    open: false,
  });
  const [toDelete, setToDelete] = React.useState<TurnServer | null>(null);

  const remove = useMutation({
    mutationFn: (s: TurnServer) => api.turn.remove(s.id),
    onSuccess: (_d, s) => {
      void qc.invalidateQueries({ queryKey: qk.turn });
      void qc.invalidateQueries({
        predicate: (x) => x.queryKey[0] === "nodes" && x.queryKey[2] === "runtime",
      });
      toast.success(t("turn.deleted", { name: s.name }));
    },
    onError: (e) => toast.error(errorMessage(e, t)),
  });

  const addButton = canEdit && (
    <Button variant="primary" onClick={() => setDialog({ open: true })}>
      <Plus />
      {t("turn.add")}
    </Button>
  );

  let list: React.ReactNode;
  if (q.isError) list = <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  else if (q.isPending)
    list = (
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-36 rounded-lg" />
        ))}
      </div>
    );
  else if (q.data.length === 0)
    list = (
      <EmptyState
        icon={PhoneCall}
        title={t("turn.emptyTitle")}
        text={t("turn.emptyText")}
        action={addButton}
      />
    );
  else
    list = (
      <ul className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {q.data.map((s) => (
          <ServerCard
            key={s.id}
            server={s}
            canEdit={canEdit}
            onEdit={() => setDialog({ open: true, server: s })}
            onDelete={() => setToDelete(s)}
          />
        ))}
      </ul>
    );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("turn.title")} subtitle={t("turn.subtitle")} actions={addButton} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        {list}
        <HowItWorks />
      </div>
      <TurnDialog
        open={dialog.open}
        server={dialog.server}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
      />
      <AlertDialog open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogTitle>
            {t("turn.deleteTitle", { name: toDelete?.name ?? "" })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("turn.deleteText", { count: toDelete?.nodes ?? 0 })}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction danger onClick={() => toDelete && remove.mutate(toDelete)}>
              <Trash2 className="size-4" aria-hidden />
              {t("turn.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
