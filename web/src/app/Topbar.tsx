import { Link } from "@tanstack/react-router";
import { Languages, LogOut, Moon, Search, Settings, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LogoMark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { currentLanguage, setLanguage } from "@/i18n";
import { toggleTheme, useTheme } from "@/lib/theme";
import { useUi } from "./ui-context";
import { useLogout } from "./useLogout";
import { useCurrentUser } from "./useCurrentUser";

function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
}

export function Topbar() {
  const { t } = useTranslation();
  const { openPalette } = useUi();
  const theme = useTheme();
  const user = useCurrentUser();
  const logout = useLogout();
  const lang = currentLanguage();

  return (
    <header className="sticky top-0 z-30 flex h-[var(--tm-topbar-h)] items-center gap-2 border-b border-line bg-bg/95 px-3 sm:gap-3 sm:px-5">
      <Link to="/" className="rounded-md md:hidden" aria-label="TrustMe Admin">
        <LogoMark />
      </Link>
      <button
        type="button"
        onClick={openPalette}
        className="group flex h-9 min-w-0 flex-1 items-center gap-2.5 rounded-md border border-line bg-surface-1 px-3 text-sm text-fg-subtle shadow-sm transition-colors hover:border-line-strong hover:text-fg-muted sm:max-w-md"
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="truncate">{t("topbar.search")}</span>
        <kbd className="ml-auto hidden items-center gap-0.5 rounded-xs border border-line-strong bg-surface-2 px-1.5 font-mono text-[11px] text-fg-subtle sm:inline-flex">
          {isMac() ? "⌘" : "Ctrl"} K
        </kbd>
      </button>
      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          aria-label={t("topbar.theme")}
          title={t("topbar.theme")}
        >
          {theme === "dark" ? <Sun /> : <Moon />}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLanguage(lang === "ru" ? "en" : "ru")}
          aria-label={`${t("topbar.language")}: ${lang === "ru" ? "EN" : "RU"}`}
          title={t("topbar.language")}
          className="px-2 font-mono text-xs uppercase"
        >
          <Languages />
          {lang === "ru" ? "en" : "ru"}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t("topbar.userMenu")}
              className="ml-1 flex size-8 items-center justify-center rounded-full bg-gradient-brand text-[13px] font-semibold text-accent-fg uppercase ring-1 ring-line-strong transition-shadow hover:shadow-glow"
            >
              {user?.username.slice(0, 1) ?? "?"}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {user && (
              <DropdownMenuLabel>
                <span className="block text-sm font-medium text-fg">{user.username}</span>
                <span>{t(`users.roles.${user.role}`)}</span>
              </DropdownMenuLabel>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/settings">
                <Settings />
                {t("nav.settings")}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => logout.mutate()}>
              <LogOut />
              {t("topbar.logout")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
