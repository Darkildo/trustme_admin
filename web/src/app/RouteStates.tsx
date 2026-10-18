import { Link, type ErrorComponentProps } from "@tanstack/react-router";
import { Compass, RefreshCw, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/errors";

export function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <EmptyState
        icon={Compass}
        title={t("errors.pageNotFound")}
        action={
          <Button asChild variant="primary">
            <Link to="/">{t("errors.toOverview")}</Link>
          </Button>
        }
      />
    </div>
  );
}

export function RouteError({ error, reset }: ErrorComponentProps) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-[60dvh] items-center justify-center px-4">
      <div role="alert" className="flex max-w-md flex-col items-center gap-3 text-center">
        <TriangleAlert className="size-8 text-fail" aria-hidden />
        <p className="text-lg font-semibold text-fg">{t("errors.generic")}</p>
        <p className="text-sm text-fg-muted">{errorMessage(error, t)}</p>
        <Button
          variant="secondary"
          onClick={() => {
            reset();
            window.location.reload();
          }}
        >
          <RefreshCw />
          {t("common.retry")}
        </Button>
      </div>
    </div>
  );
}

export function FullPageLoader() {
  return (
    <div className="flex min-h-dvh items-center justify-center" aria-busy="true">
      <span className="size-8 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
    </div>
  );
}
