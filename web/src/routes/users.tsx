import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, CircleCheck, Ellipsis, ShieldCheck, ShieldOff, Trash2, Users } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useCurrentUser } from "@/app/useCurrentUser";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast-store";
import { InviteDialog } from "@/features/users/InviteDialog";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { formatRelative } from "@/lib/format";
import { qk, usersQuery } from "@/lib/queries";
import type { Role, User } from "@/lib/types";
import { cn } from "@/lib/utils";

const ROLES: Role[] = ["owner", "admin", "viewer"];

function UserState({ user }: { user: User }) {
  const { t } = useTranslation();
  if (user.disabled)
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-fail">
        <Ban className="size-3.5" aria-hidden />
        {t("users.disabled")}
      </span>
    );
  if (user.last_login_at === null)
    return <span className="text-xs text-fg-subtle">{t("users.pending")}</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ok">
      <CircleCheck className="size-3.5" aria-hidden />
      {t("users.active")}
    </span>
  );
}

export function UsersPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const me = useCurrentUser();
  const q = useQuery(usersQuery);
  const [toDelete, setToDelete] = React.useState<User | null>(null);

  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: { role?: Role; disabled?: boolean } }) =>
      api.users.update(id, input),
    onSuccess: () => toast.success(t("users.updated")),
    onError: (e) => toast.error(errorMessage(e, t)),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.users }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.users.remove(id),
    onSuccess: () => toast.success(t("users.deleted")),
    onError: (e) => toast.error(errorMessage(e, t)),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.users }),
  });

  const actions = (u: User) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("users.actions", { username: u.username })}
        >
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onSelect={() => update.mutate({ id: u.id, input: { disabled: !u.disabled } })}
        >
          {u.disabled ? <ShieldCheck /> : <ShieldOff />}
          {u.disabled ? t("users.enable") : t("users.disable")}
        </DropdownMenuItem>
        {u.id !== me?.id && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem danger onSelect={() => setToDelete(u)}>
              <Trash2 />
              {t("users.delete")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const roleSelect = (u: User) => (
    <Select
      value={u.role}
      onValueChange={(v) => update.mutate({ id: u.id, input: { role: v as Role } })}
    >
      <SelectTrigger
        className="h-8 w-40 text-[13px]"
        aria-label={`${t("users.changeRole")}: ${u.username}`}
      >
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
  );

  const name = (u: User) => (
    <span className="flex items-center gap-2.5">
      <span
        aria-hidden
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold uppercase",
          u.disabled ? "bg-surface-3 text-fg-subtle" : "bg-gradient-brand text-accent-fg",
        )}
      >
        {u.username.slice(0, 1)}
      </span>
      <span className={cn("font-medium", u.disabled ? "text-fg-subtle line-through" : "text-fg")}>
        {u.username}
      </span>
      {u.id === me?.id && (
        <span className="rounded-full border border-accent/40 px-1.5 text-[10px] text-accent">
          {t("common.you")}
        </span>
      )}
    </span>
  );

  const totp = (u: User) => (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs",
        u.totp_enabled ? "text-ok" : "text-fg-subtle",
      )}
    >
      {u.totp_enabled ? (
        <ShieldCheck className="size-3.5" aria-hidden />
      ) : (
        <ShieldOff className="size-3.5" aria-hidden />
      )}
      {u.totp_enabled ? t("users.totpOn") : t("users.totpOff")}
    </span>
  );

  const lastLogin = (u: User) => (
    <span className="text-xs text-fg-muted tabular">
      {u.last_login_at ? formatRelative(u.last_login_at, i18n.language) : t("users.never")}
    </span>
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("users.title")}
        subtitle={t("users.subtitle")}
        actions={<InviteDialog />}
      />
      {q.isPending ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState icon={Users} title={t("users.title")} />
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-lg border border-line bg-surface-1 md:block">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-bg-elevated text-left text-xs text-fg-subtle">
                <tr>
                  <th scope="col" className="py-2.5 pr-3 pl-4 font-medium">
                    {t("users.username")}
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium">
                    {t("users.role")}
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium">
                    {t("users.totp")}
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium">
                    {t("users.state")}
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium">
                    {t("users.lastLogin")}
                  </th>
                  <th scope="col" className="py-2.5 pr-4 pl-3">
                    <span className="sr-only">{t("users.actions", { username: "" })}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((u) => (
                  <tr key={u.id} className="border-b border-line last:border-0">
                    <td className="py-2.5 pr-3 pl-4">{name(u)}</td>
                    <td className="px-3 py-2.5">{roleSelect(u)}</td>
                    <td className="px-3 py-2.5">{totp(u)}</td>
                    <td className="px-3 py-2.5">
                      <UserState user={u} />
                    </td>
                    <td className="px-3 py-2.5">{lastLogin(u)}</td>
                    <td className="py-2.5 pr-4 pl-3 text-right">{actions(u)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="flex flex-col gap-2.5 md:hidden">
            {q.data.map((u) => (
              <li
                key={u.id}
                className="flex flex-col gap-3 rounded-lg border border-line bg-surface-1 p-3.5"
              >
                <div className="flex items-center justify-between gap-2">
                  {name(u)}
                  {actions(u)}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  {roleSelect(u)}
                  <UserState user={u} />
                  <span className="text-xs text-fg-subtle">TOTP: {totp(u)}</span>
                  {lastLogin(u)}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <AlertDialog open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogTitle>
            {t("users.deleteTitle", { username: toDelete?.username ?? "" })}
          </AlertDialogTitle>
          <AlertDialogDescription>{t("users.deleteText")}</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction danger onClick={() => toDelete && remove.mutate(toDelete.id)}>
              {t("users.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
