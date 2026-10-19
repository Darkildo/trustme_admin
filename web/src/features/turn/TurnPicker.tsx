import { Check, Server } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TurnServer } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Multi-select of TURN servers as toggle chips. */
export function TurnPicker({
  servers,
  value,
  onChange,
  label,
  disabled,
  highlightNodeId,
}: {
  servers: TurnServer[];
  value: string[];
  onChange?: (ids: string[]) => void;
  label: string;
  disabled?: boolean;
  /** Mark the coturn managed by this node. */
  highlightNodeId?: string;
}) {
  const { t } = useTranslation();
  const toggle = (id: string) =>
    onChange?.(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {servers.map((s) => {
        const on = value.includes(s.id);
        const own = highlightNodeId !== undefined && s.managed_by_node?.id === highlightNodeId;
        return (
          <button
            key={s.id}
            type="button"
            aria-pressed={on}
            disabled={disabled || !onChange}
            onClick={() => toggle(s.id)}
            title={s.urls.join("\n")}
            className={cn(
              "inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors disabled:cursor-default",
              on
                ? "border-accent/40 bg-accent-soft text-fg"
                : "border-line bg-surface-1 text-fg-muted enabled:hover:border-line-strong enabled:hover:text-fg",
              disabled && !on && "opacity-60",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "flex size-4 shrink-0 items-center justify-center rounded-full border",
                on ? "border-accent bg-accent text-accent-fg" : "border-line-strong",
              )}
            >
              {on && <Check className="size-3" strokeWidth={3} />}
            </span>
            <span className="truncate">{s.name}</span>
            {own && (
              <span className="inline-flex items-center gap-1 text-[11px] text-accent-2">
                <Server className="size-3" aria-hidden />
                {t("runtime.turnThisNode")}
              </span>
            )}
            <span className="font-mono text-[11px] text-fg-subtle tabular">{s.urls.length}</span>
          </button>
        );
      })}
    </div>
  );
}
