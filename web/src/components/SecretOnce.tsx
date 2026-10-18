import { KeyRound, TriangleAlert } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { CopyButton } from "./CopyButton";

/** A one-time secret (token, invite link) with a copy button and a "shown once" warning. */
export function SecretOnce({
  label,
  value,
  warning,
}: {
  label: string;
  value: string;
  warning: string;
}) {
  const { t } = useTranslation();
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-2.5"
    >
      <div className="flex items-start gap-2.5 rounded-md border border-warn/30 bg-warn-soft px-3 py-2.5 text-sm text-fg">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
        <span>{warning}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="flex items-center gap-1.5 text-[13px] font-medium text-fg">
          <KeyRound className="size-3.5 text-accent" aria-hidden />
          {label}
        </span>
        <div className="flex items-center gap-2 rounded-md border border-accent/40 bg-accent-soft py-1 pr-1 pl-3 shadow-glow">
          <code className="min-w-0 flex-1 font-mono text-[13px] break-all text-fg select-all">
            {value}
          </code>
          <CopyButton value={value} variant="primary" showText toastTitle={t("common.copied")} />
        </div>
      </div>
    </motion.div>
  );
}
