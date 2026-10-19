import { Languages, Moon, Sun } from "lucide-react";
import { motion } from "motion/react";
import type * as React from "react";
import { useTranslation } from "react-i18next";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { currentLanguage, setLanguage } from "@/i18n";
import { toggleTheme, useTheme } from "@/lib/theme";

export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const lang = currentLanguage();
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4 py-10">
      <div
        aria-hidden
        className="grid-bg absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)] opacity-50"
      />
      <div
        aria-hidden
        className="absolute top-[-20%] left-1/2 h-[480px] w-[720px] -translate-x-1/2 rounded-full bg-gradient-brand opacity-[0.14] blur-3xl"
      />
      <div className="absolute top-4 right-4 flex gap-1">
        <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label={t("topbar.theme")}>
          {theme === "dark" ? <Sun /> : <Moon />}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="font-mono text-xs uppercase"
          onClick={() => setLanguage(lang === "ru" ? "en" : "ru")}
          aria-label={t("topbar.language")}
        >
          <Languages />
          {lang === "ru" ? "en" : "ru"}
        </Button>
      </div>
      <motion.main
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-sm"
      >
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <div className="rounded-xl border border-line-strong bg-surface-1/95 p-6 shadow-lg sm:p-7">
          <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-fg-muted">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </motion.main>
    </div>
  );
}
