import { CircleAlert, RefreshCw, Save } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

/** Sticky «unsaved changes» bar shown under a form while its draft differs from the server. */
export function SaveBar({
  dirty,
  invalid,
  pending,
  onSave,
  onDiscard,
  saveLabel,
}: {
  dirty: boolean;
  invalid: boolean;
  pending: boolean;
  onSave: () => void;
  onDiscard: () => void;
  saveLabel?: string;
}) {
  const { t } = useTranslation();
  return (
    <AnimatePresence>
      {dirty && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.18 }}
          className="sticky bottom-[calc(var(--tm-bottomnav-h)+12px)] z-20 md:bottom-4"
        >
          <div
            role="region"
            aria-label={t("limits.unsaved")}
            className="flex flex-col gap-3 rounded-lg border border-accent/35 bg-surface-2 px-4 py-3 shadow-lg sm:flex-row sm:items-center"
          >
            <p className="flex items-center gap-2 text-sm text-fg">
              {invalid ? (
                <CircleAlert className="size-4 shrink-0 text-fail" aria-hidden />
              ) : (
                <span aria-hidden className="size-2 shrink-0 rounded-full bg-warn" />
              )}
              {invalid ? t("limits.fixErrors") : t("limits.unsaved")}
            </p>
            <div className="flex gap-2 sm:ml-auto">
              <Button
                variant="ghost"
                onClick={onDiscard}
                disabled={pending}
                className="flex-1 sm:flex-none"
              >
                {t("limits.discard")}
              </Button>
              <Button
                variant="primary"
                onClick={onSave}
                disabled={pending || invalid}
                className="flex-1 sm:flex-none"
              >
                {pending ? <RefreshCw className="animate-spin" /> : <Save />}
                {pending ? t("common.saving") : (saveLabel ?? t("common.save"))}
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
