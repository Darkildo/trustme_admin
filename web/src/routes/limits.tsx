import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ellipsis,
  Info,
  Pencil,
  Plus,
  Server,
  SlidersHorizontal,
  Star,
  Trash2,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast-store";
import { LimitsEditor } from "@/features/limits/LimitsEditor";
import { CreateProfileDialog, RenameProfileDialog } from "@/features/limits/ProfileDialogs";
import { SaveBar } from "@/features/limits/SaveBar";
import { sameSettings, validateSettings } from "@/features/limits/validation";
import { api, isApiError } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { formatRelative } from "@/lib/format";
import { catalogQuery, profilesQuery, qk } from "@/lib/queries";
import type { Profile, Setting, Settings } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { cn } from "@/lib/utils";

function DefaultBadge() {
  const { t } = useTranslation();
  return (
    <span className="inline-flex h-5 items-center gap-1 rounded-full border border-accent/35 bg-accent-soft px-2 text-[11px] font-medium text-accent">
      <Star className="size-3 fill-current" aria-hidden />
      {t("profiles.default")}
    </span>
  );
}

function ProfileList({
  profiles,
  total,
  selected,
  onSelect,
}: {
  profiles: Profile[];
  total: number;
  selected: string;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t("profiles.list")} className="flex flex-col gap-1.5">
      <h2 className="px-1 text-[13px] font-semibold tracking-wide text-fg-muted uppercase">
        {t("profiles.list")}
      </h2>
      <ul className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
        {profiles.map((p) => {
          const active = p.id === selected;
          return (
            <li key={p.id} className="shrink-0 lg:shrink">
              <button
                type="button"
                onClick={() => onSelect(p.id)}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "group relative flex w-56 flex-col gap-1.5 rounded-lg border px-3.5 py-3 text-left transition-colors lg:w-full",
                  active
                    ? "border-accent/40 bg-surface-2 shadow-sm"
                    : "border-line bg-surface-1 hover:border-line-strong hover:bg-surface-2",
                )}
              >
                {active && (
                  <span
                    aria-hidden
                    className="absolute top-3 bottom-3 left-0 w-0.5 rounded-full bg-accent"
                  />
                )}
                <span className="flex items-center gap-2">
                  <span className="truncate font-medium text-fg">{p.name}</span>
                  {p.is_default && <DefaultBadge />}
                </span>
                <span className="flex items-center gap-3 text-xs text-fg-subtle tabular">
                  <span className="inline-flex items-center gap-1">
                    <Server className="size-3" aria-hidden />
                    {t("common.nodes", { count: p.nodes })}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <SlidersHorizontal className="size-3" aria-hidden />
                    {t("profiles.setCount", { count: Object.keys(p.settings).length, total })}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function ProfileEditor({
  profile,
  profiles,
  catalog,
  onDirtyChange,
}: {
  profile: Profile;
  profiles: Profile[];
  catalog: Setting[];
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const canEdit = useCan("admin");
  const now = useNow(30_000) / 1000;
  const [draft, setDraft] = React.useState<Settings>(profile.settings);
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  const dirty = !sameSettings(draft, profile.settings);
  const invalid = Object.keys(validateSettings(catalog, draft)).length > 0;
  React.useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.profiles });
    // Every node runtime that uses the profile changes its desired version.
    void qc.invalidateQueries({
      predicate: (q) => q.queryKey[0] === "nodes" && q.queryKey[2] === "runtime",
    });
  };

  const save = useMutation({
    mutationFn: (settings: Settings) => api.profiles.update(profile.id, { settings }),
    onSuccess: (p) => {
      setDraft(p.settings);
      refresh();
      toast.success(t("profiles.saved"));
    },
  });
  const rename = useMutation({
    mutationFn: (name: string) => api.profiles.update(profile.id, { name }),
    onSuccess: () => {
      setRenameOpen(false);
      refresh();
      toast.success(t("profiles.renamed"));
    },
  });
  const makeDefault = useMutation({
    mutationFn: () => api.profiles.makeDefault(profile.id),
    onSuccess: (p) => {
      refresh();
      toast.success(t("profiles.madeDefault", { name: p.name }));
    },
    onError: (e) => toast.error(errorMessage(e, t)),
  });
  const remove = useMutation({
    mutationFn: () => api.profiles.remove(profile.id),
    onSuccess: () => {
      refresh();
      toast.success(t("profiles.deleted", { name: profile.name }));
    },
    onError: (e) => toast.error(errorMessage(e, t)),
  });

  const fallback = profiles.find((p) => p.is_default);
  const serverMessage =
    save.error && isApiError(save.error, "invalid_input")
      ? save.error.message
      : save.error
        ? errorMessage(save.error, t)
        : null;

  return (
    <section aria-labelledby="profile-title" className="flex min-w-0 flex-col gap-4">
      <div className="relative overflow-hidden rounded-xl border border-line-strong bg-surface-1 shadow-sm">
        <div aria-hidden className="absolute inset-0 bg-gradient-soft opacity-70" />
        <div className="relative flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="profile-title" className="text-lg font-semibold tracking-tight text-fg">
                {profile.name}
              </h2>
              {profile.is_default && <DefaultBadge />}
            </div>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted tabular">
              <span>{t("profiles.nodesOn", { count: profile.nodes })}</span>
              <span>
                {t("profiles.setCount", {
                  count: Object.keys(profile.settings).length,
                  total: catalog.length,
                })}
              </span>
              <span>
                {t("profiles.updated", {
                  ago: formatRelative(profile.updated_at, i18n.language, now),
                })}
              </span>
            </p>
          </div>
          {canEdit && (
            <div className="flex items-center gap-2">
              {!profile.is_default && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={makeDefault.isPending}
                  onClick={() => makeDefault.mutate()}
                >
                  <Star />
                  {t("profiles.makeDefault")}
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("profiles.actions", { name: profile.name })}
                  >
                    <Ellipsis />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
                    <Pencil />
                    {t("profiles.rename")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    danger
                    disabled={profile.is_default}
                    onSelect={() => setDeleteOpen(true)}
                  >
                    <Trash2 />
                    {t("profiles.delete")}
                  </DropdownMenuItem>
                  {profile.is_default && (
                    <DropdownMenuLabel className="max-w-60 font-normal">
                      {t("profiles.deleteDefault")}
                    </DropdownMenuLabel>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
        {profile.is_default && (
          <p className="relative flex items-start gap-2 border-t border-line px-4 py-2.5 text-xs text-fg-muted sm:px-5">
            <Info className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />
            {t("profiles.defaultExplainer")}
          </p>
        )}
      </div>

      <LimitsEditor
        catalog={catalog}
        values={draft}
        saved={profile.settings}
        onChange={
          canEdit
            ? (next) => {
                if (save.error) save.reset();
                setDraft(next);
              }
            : undefined
        }
        layer="profile"
        serverMessage={serverMessage}
      />

      <SaveBar
        dirty={dirty}
        invalid={invalid}
        pending={save.isPending}
        onSave={() => save.mutate(draft)}
        onDiscard={() => {
          save.reset();
          setDraft(profile.settings);
        }}
      />

      <RenameProfileDialog
        open={renameOpen}
        onOpenChange={(o) => {
          setRenameOpen(o);
          if (!o) rename.reset();
        }}
        profile={profile}
        pending={rename.isPending}
        serverError={rename.error ? errorMessage(rename.error, t) : null}
        onSubmit={(name) => rename.mutate(name)}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogTitle>{t("profiles.deleteTitle", { name: profile.name })}</AlertDialogTitle>
          <AlertDialogDescription>
            {profile.nodes > 0
              ? t("profiles.deleteText", { count: profile.nodes, fallback: fallback?.name ?? "—" })
              : t("profiles.deleteTextEmpty")}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction danger onClick={() => remove.mutate()}>
              <Trash2 className="size-4" aria-hidden />
              {t("profiles.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

export function LimitsPage({
  selected,
  onSelect,
}: {
  selected?: string;
  onSelect: (id: string | undefined) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const canEdit = useCan("admin");
  const catalog = useQuery(catalogQuery);
  const profiles = useQuery(profilesQuery);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const [pendingSwitch, setPendingSwitch] = React.useState<string | null>(null);

  const create = useMutation({
    mutationFn: (input: { name: string; settings: Settings }) => api.profiles.create(input),
    onSuccess: (p) => {
      setCreateOpen(false);
      void qc.invalidateQueries({ queryKey: qk.profiles });
      toast.success(t("profiles.created", { name: p.name }));
      onSelect(p.id);
    },
  });

  const list = profiles.data ?? [];
  const current = list.find((p) => p.id === selected) ?? list.find((p) => p.is_default) ?? list[0];

  const select = (id: string) => {
    if (id === current?.id) return;
    if (dirty) setPendingSwitch(id);
    else onSelect(id);
  };

  const header = (
    <PageHeader
      title={t("limits.title")}
      subtitle={t("limits.subtitle")}
      actions={
        canEdit && (
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus />
            {t("profiles.create")}
          </Button>
        )
      }
    />
  );

  let body: React.ReactNode;
  if (catalog.isError || profiles.isError) {
    body = (
      <ErrorState
        error={catalog.error ?? profiles.error}
        onRetry={() => {
          void catalog.refetch();
          void profiles.refetch();
        }}
      />
    );
  } else if (catalog.isPending || profiles.isPending) {
    body = (
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-9 w-80" />
          <Skeleton className="h-72 rounded-lg" />
        </div>
      </div>
    );
  } else if (!current) {
    body = <EmptyState icon={SlidersHorizontal} title={t("profiles.emptyTitle")} />;
  } else {
    body = (
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start">
        <div className="lg:sticky lg:top-[calc(var(--tm-topbar-h)+20px)]">
          <ProfileList
            profiles={list}
            total={catalog.data.length}
            selected={current.id}
            onSelect={select}
          />
        </div>
        <ProfileEditor
          key={current.id}
          profile={current}
          profiles={list}
          catalog={catalog.data}
          onDirtyChange={setDirty}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {header}
      {body}
      <CreateProfileDialog
        open={createOpen}
        onOpenChange={(o) => {
          setCreateOpen(o);
          if (!o) create.reset();
        }}
        profiles={list}
        pending={create.isPending}
        serverError={create.error ? errorMessage(create.error, t) : null}
        onSubmit={(input) => create.mutate(input)}
      />
      <AlertDialog
        open={pendingSwitch !== null}
        onOpenChange={(o) => {
          if (!o) setPendingSwitch(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>{t("limits.unsaved")}</AlertDialogTitle>
          <AlertDialogDescription>{t("limits.discardText")}</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              danger
              onClick={() => {
                const id = pendingSwitch;
                setPendingSwitch(null);
                setDirty(false);
                if (id) onSelect(id);
              }}
            >
              {t("limits.discard")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
