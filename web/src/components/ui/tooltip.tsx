import { Tooltip as TP } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

export const TooltipProvider = TP.Provider;

export function Tooltip({
  content,
  children,
  side = "top",
  disabled = false,
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  disabled?: boolean;
}) {
  if (disabled) return <>{children}</>;
  return (
    <TP.Root>
      <TP.Trigger asChild>{children}</TP.Trigger>
      <TP.Portal>
        <TP.Content
          side={side}
          sideOffset={6}
          className={cn(
            "z-50 max-w-xs rounded-sm border border-line-strong bg-surface-3 px-2 py-1 text-xs text-fg shadow-md",
          )}
        >
          {content}
        </TP.Content>
      </TP.Portal>
    </TP.Root>
  );
}
