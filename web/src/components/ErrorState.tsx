import { RefreshCw, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { errorMessage } from "@/lib/errors";
import { Button } from "./ui/button";

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-xl border border-fail/30 bg-fail-soft px-6 py-12 text-center"
    >
      <TriangleAlert className="size-6 text-fail" aria-hidden />
      <div>
        <p className="font-medium text-fg">{t("errors.loadFailed")}</p>
        <p className="mt-1 text-sm text-fg-muted">{errorMessage(error, t)}</p>
      </div>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          <RefreshCw />
          {t("common.retry")}
        </Button>
      )}
    </div>
  );
}
