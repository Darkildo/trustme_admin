import { Link, useRouterState } from "@tanstack/react-router";
import { Ellipsis, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Logo } from "@/components/Logo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { roleAtLeast } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "./nav";
import { useCurrentUser } from "./useCurrentUser";

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const items = NAV_ITEMS.filter((i) => roleAtLeast(user?.role, i.min));
  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-bg-elevated transition-[width] duration-200 ease-out md:flex",
        collapsed ? "w-[var(--tm-sidebar-w-collapsed)]" : "w-[var(--tm-sidebar-w)]",
      )}
    >
      <div
        className={cn(
          "flex h-[var(--tm-topbar-h)] items-center border-b border-line",
          collapsed ? "justify-center px-0" : "px-4",
        )}
      >
        <Link to="/" aria-label="TrustMe Admin" className="rounded-md">
          <Logo collapsed={collapsed} />
        </Link>
      </div>
      <nav aria-label={t("nav.main")} className="flex flex-1 flex-col gap-0.5 p-2">
        {items.map((item) => {
          const Icon = item.icon;
          const label = t(item.labelKey);
          return (
            <Tooltip key={item.to} content={label} side="right" disabled={!collapsed}>
              <Link
                to={item.to}
                activeOptions={{ exact: item.to === "/" }}
                aria-label={collapsed ? label : undefined}
                className={cn(
                  "group relative flex h-9 items-center gap-3 rounded-md text-sm font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg data-[status=active]:bg-surface-2 data-[status=active]:text-fg",
                  collapsed ? "justify-center px-0" : "px-3",
                )}
              >
                <span
                  aria-hidden
                  className="absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-accent opacity-0 transition-opacity group-data-[status=active]:opacity-100"
                />
                <Icon
                  className="size-4 shrink-0 group-data-[status=active]:text-accent"
                  aria-hidden
                />
                {!collapsed && <span className="truncate">{label}</span>}
              </Link>
            </Tooltip>
          );
        })}
      </nav>
      <div className="border-t border-line p-2">
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? t("nav.expand") : t("nav.collapse")}
          title={collapsed ? t("nav.expand") : t("nav.collapse")}
          className={cn(
            "flex h-9 w-full items-center gap-3 rounded-md text-sm text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg",
            collapsed ? "justify-center" : "px-3",
          )}
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4" aria-hidden />
          ) : (
            <PanelLeftClose className="size-4" aria-hidden />
          )}
          {!collapsed && <span>{t("nav.collapseShort")}</span>}
        </button>
      </div>
    </aside>
  );
}

const bottomItemClass =
  "group flex min-w-0 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium text-fg-subtle transition-colors data-[status=active]:text-accent";

export function BottomNav() {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const items = NAV_ITEMS.filter((i) => roleAtLeast(user?.role, i.min));
  const primary = items.filter((i) => i.mobile === "primary");
  const more = items.filter((i) => i.mobile === "more");
  const moreActive = more.some((i) => pathname === i.to || pathname.startsWith(`${i.to}/`));
  return (
    <nav
      aria-label={t("nav.main")}
      className="fixed inset-x-0 bottom-0 z-40 flex h-[var(--tm-bottomnav-h)] items-stretch border-t border-line bg-bg-elevated pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {primary.map((item) => {
        const Icon = item.icon;
        return (
          <Link
            key={item.to}
            to={item.to}
            activeOptions={{ exact: item.to === "/" }}
            className={bottomItemClass}
          >
            <Icon className="size-5" aria-hidden />
            <span className="max-w-full truncate px-1">
              {t(item.shortLabelKey ?? item.labelKey)}
            </span>
          </Link>
        );
      })}
      {more.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-status={moreActive ? "active" : undefined}
              className={bottomItemClass}
            >
              <Ellipsis className="size-5" aria-hidden />
              <span className="max-w-full truncate px-1">{t("nav.more")}</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top">
            {more.map((item) => {
              const Icon = item.icon;
              return (
                <DropdownMenuItem key={item.to} asChild>
                  <Link to={item.to}>
                    <Icon />
                    {t(item.labelKey)}
                  </Link>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </nav>
  );
}
