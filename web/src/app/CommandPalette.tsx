import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Command } from "cmdk";
import { Languages, Plus, Search, SunMoon, Zap } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useTranslation } from "react-i18next";
import { StatusIcon } from "@/components/StatusBadge";
import { useProbeNow } from "@/features/nodes/useProbeNow";
import { currentLanguage, setLanguage } from "@/i18n";
import { roleAtLeast } from "@/lib/auth";
import { nodesQuery } from "@/lib/queries";
import { toggleTheme } from "@/lib/theme";
import { NAV_ITEMS } from "./nav";
import { useCurrentUser } from "./useCurrentUser";

const itemClass =
  "flex h-10 cursor-default items-center gap-3 rounded-md px-3 text-sm text-fg-muted outline-none select-none data-[selected=true]:bg-surface-3 data-[selected=true]:text-fg [&_svg]:size-4 [&_svg]:shrink-0";
const groupClass =
  "[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-fg-subtle [&_[cmdk-group-heading]]:uppercase";

export function CommandPalette({
  open,
  onOpenChange,
  onAddNode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddNode: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useCurrentUser();
  const isAdmin = roleAtLeast(user?.role, "admin");
  const nodes = useQuery({ ...nodesQuery, enabled: open }).data ?? [];
  const probe = useProbeNow();

  const run = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="animate-fade-in fixed inset-0 z-50 bg-overlay" />
        <DialogPrimitive.Content className="animate-dialog-in fixed top-[12vh] left-1/2 z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-line-strong bg-surface-1 shadow-lg outline-none">
          <DialogPrimitive.Title className="sr-only">{t("palette.title")}</DialogPrimitive.Title>
          <Command label={t("palette.title")} loop>
            <div className="flex items-center gap-2.5 border-b border-line px-4">
              <Search className="size-4 shrink-0 text-fg-subtle" aria-hidden />
              <Command.Input
                autoFocus
                placeholder={t("palette.placeholder")}
                className="h-12 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-fg-subtle"
              />
              <kbd className="rounded-xs border border-line-strong px-1.5 font-mono text-[10px] text-fg-subtle">
                Esc
              </kbd>
            </div>
            <Command.List className="max-h-[min(60vh,420px)] overflow-y-auto p-2">
              <Command.Empty className="py-10 text-center text-sm text-fg-subtle">
                {t("palette.empty")}
              </Command.Empty>

              {nodes.length > 0 && (
                <Command.Group heading={t("palette.nodes")} className={groupClass}>
                  {nodes.map((n) => (
                    <Command.Item
                      key={n.id}
                      value={`node ${n.name} ${n.addr} ${n.id}`}
                      onSelect={() =>
                        run(() => void navigate({ to: "/nodes/$id", params: { id: n.id } }))
                      }
                      className={itemClass}
                    >
                      <StatusIcon status={n.status} />
                      <span className="font-medium text-fg">{n.name}</span>
                      <span className="ml-auto truncate font-mono text-xs text-fg-subtle">
                        {n.addr}
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              <Command.Group heading={t("palette.actions")} className={groupClass}>
                {isAdmin && (
                  <Command.Item
                    value="new node add install ssh новая нода добавить установить"
                    onSelect={() => run(onAddNode)}
                    className={itemClass}
                  >
                    <Plus className="text-accent" />
                    {t("palette.addNode")}
                  </Command.Item>
                )}
                <Command.Item
                  value="theme тема toggle"
                  onSelect={() => run(toggleTheme)}
                  className={itemClass}
                >
                  <SunMoon />
                  {t("palette.toggleTheme")}
                </Command.Item>
                <Command.Item
                  value="language язык english русский"
                  onSelect={() => run(() => setLanguage(currentLanguage() === "ru" ? "en" : "ru"))}
                  className={itemClass}
                >
                  <Languages />
                  {t("palette.switchLanguage")}
                </Command.Item>
              </Command.Group>

              {isAdmin && nodes.length > 0 && (
                <Command.Group heading={t("palette.probe")} className={groupClass}>
                  {nodes.map((n) => (
                    <Command.Item
                      key={n.id}
                      value={`probe check проверить ${n.name} ${n.addr}`}
                      onSelect={() => run(() => probe.mutate({ id: n.id, name: n.name }))}
                      className={itemClass}
                    >
                      <Zap className="text-accent" />
                      {t("palette.probeNode", { name: n.name })}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              <Command.Group heading={t("palette.navigate")} className={groupClass}>
                {NAV_ITEMS.filter((i) => roleAtLeast(user?.role, i.min)).map((item) => {
                  const Icon = item.icon;
                  return (
                    <Command.Item
                      key={item.to}
                      value={`go ${t(item.labelKey)} ${item.to} ${item.keywords ?? ""}`}
                      onSelect={() => run(() => void navigate({ to: item.to }))}
                      className={itemClass}
                    >
                      <Icon />
                      {t(item.labelKey)}
                    </Command.Item>
                  );
                })}
              </Command.Group>
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
