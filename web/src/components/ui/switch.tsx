import { Switch as SwitchPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-line-strong bg-surface-3 p-0.5 transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-3.5 rounded-full bg-fg-subtle shadow-sm transition-transform duration-150 data-[state=checked]:translate-x-4 data-[state=checked]:bg-accent-fg" />
    </SwitchPrimitive.Root>
  );
}
