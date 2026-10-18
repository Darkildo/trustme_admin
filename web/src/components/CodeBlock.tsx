import { Terminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { CopyButton } from "./CopyButton";

export function CodeBlock({
  code,
  label,
  className,
}: {
  code: string;
  label?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className={cn("overflow-hidden rounded-lg border border-line-strong bg-bg", className)}>
      <div className="flex items-center justify-between gap-2 border-b border-line bg-surface-1 px-3 py-1.5">
        <span className="flex items-center gap-2 text-xs text-fg-subtle">
          <Terminal className="size-3.5" aria-hidden />
          {label}
        </span>
        <CopyButton value={code} showText toastTitle={t("common.copied")} />
      </div>
      <pre className="overflow-x-auto px-3.5 py-3 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] text-fg">
        <code>{code}</code>
      </pre>
    </div>
  );
}
