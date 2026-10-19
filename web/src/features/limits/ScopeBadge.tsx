import { useTranslation } from "react-i18next";
import { Tooltip } from "@/components/ui/tooltip";
import { TONE_CLASSES } from "@/lib/tone";
import type { Scope } from "@/lib/types";
import { cn } from "@/lib/utils";
import { SCOPE_META } from "./meta";

/** When a change takes effect: «сразу», «для новых сессий», «после перезапуска». */
export function ScopeBadge({ scope, className }: { scope: Scope; className?: string }) {
  const { t } = useTranslation();
  const meta = SCOPE_META[scope];
  const Icon = meta.icon;
  const tone = TONE_CLASSES[meta.tone];
  return (
    <Tooltip content={t(`limits.scopeHint.${scope}`)}>
      <span
        tabIndex={0}
        data-scope={scope}
        className={cn(
          "inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-1.5 text-[11px] font-medium whitespace-nowrap",
          tone.text,
          tone.bg,
          tone.border,
          className,
        )}
      >
        <Icon className="size-3" aria-hidden strokeWidth={2.25} />
        {t(`limits.scope.${scope}`)}
      </span>
    </Tooltip>
  );
}
