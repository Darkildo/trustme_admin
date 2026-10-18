import { DropdownMenu as DM } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

export const DropdownMenu = DM.Root;
export const DropdownMenuTrigger = DM.Trigger;

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof DM.Content>) {
  return (
    <DM.Portal>
      <DM.Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-48 overflow-hidden rounded-md border border-line-strong bg-surface-2 p-1 shadow-lg",
          className,
        )}
        {...props}
      />
    </DM.Portal>
  );
}

export function DropdownMenuItem({
  className,
  danger,
  ...props
}: React.ComponentProps<typeof DM.Item> & { danger?: boolean }) {
  return (
    <DM.Item
      className={cn(
        "flex h-8 cursor-default items-center gap-2 rounded-sm px-2 text-sm text-fg outline-none select-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-3 [&_svg]:size-4 [&_svg]:text-fg-subtle",
        danger && "text-fail data-[highlighted]:bg-fail-soft [&_svg]:text-fail",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof DM.Label>) {
  return <DM.Label className={cn("px-2 py-1.5 text-xs text-fg-subtle", className)} {...props} />;
}

export function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DM.Separator>) {
  return <DM.Separator className={cn("my-1 h-px bg-line", className)} {...props} />;
}
