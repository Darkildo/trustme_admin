import { Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCurrentUser } from "@/app/useCurrentUser";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { PasswordCard } from "@/features/settings/PasswordCard";
import { TotpCard } from "@/features/settings/TotpCard";
import { currentLanguage, setLanguage, type Language } from "@/i18n";
import { formatDateTime } from "@/lib/format";
import { setTheme, useTheme, type Theme } from "@/lib/theme";

export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const user = useCurrentUser();
  const theme = useTheme();
  if (!user) return null;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("profile.title")} subtitle={t("profile.subtitle")} />
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader>
              <CardTitle>{t("profile.account")}</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center gap-4">
              <span
                aria-hidden
                className="flex size-12 items-center justify-center rounded-full bg-gradient-brand text-lg font-semibold text-accent-fg uppercase shadow-glow"
              >
                {user.username.slice(0, 1)}
              </span>
              <div className="flex flex-col">
                <span className="text-base font-semibold text-fg">{user.username}</span>
                <span className="text-sm text-fg-muted">
                  {t(`users.roles.${user.role}`)} ·{" "}
                  {t("profile.since", { date: formatDateTime(user.created_at, i18n.language) })}
                </span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t("profile.appearance.title")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-fg">{t("profile.appearance.theme")}</span>
                <Segmented<Theme>
                  label={t("profile.appearance.theme")}
                  value={theme}
                  onChange={setTheme}
                  options={[
                    {
                      value: "dark",
                      label: (
                        <>
                          <Moon aria-hidden />
                          {t("profile.appearance.dark")}
                        </>
                      ),
                    },
                    {
                      value: "light",
                      label: (
                        <>
                          <Sun aria-hidden />
                          {t("profile.appearance.light")}
                        </>
                      ),
                    },
                  ]}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-fg">{t("profile.appearance.language")}</span>
                <Segmented<Language>
                  label={t("profile.appearance.language")}
                  value={currentLanguage()}
                  onChange={setLanguage}
                  options={[
                    { value: "ru", label: "Русский" },
                    { value: "en", label: "English" },
                  ]}
                />
              </div>
            </CardContent>
          </Card>
          <TotpCard user={user} />
        </div>
        <PasswordCard />
      </div>
    </div>
  );
}
