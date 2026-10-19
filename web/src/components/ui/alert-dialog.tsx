import { AlertDialog as AD } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "./button-variants";

export const AlertDialog = AD.Root;
export const AlertDialogTrigger = AD.Trigger;

export function AlertDialogContent({
  className,
  ...props
}: React.ComponentProps<typeof AD.Content>) {
  return (
    <AD.Portal>
      <AD.Overlay className="animate-fade-in fixed inset-0 z-50 bg-overlay" />
      <AD.Content
        className={cn(
          "animate-dialog-in fixed top-1/2 left-1/2 z-50 flex w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-xl border border-line-strong bg-surface-1 p-5 shadow-lg outline-none",
          className,
        )}
        {...props}
      />
    </AD.Portal>
  );
}

export function AlertDialogTitle({ className, ...props }: React.ComponentProps<typeof AD.Title>) {
  return <AD.Title className={cn("text-base font-semibold text-fg", className)} {...props} />;
}

export function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AD.Description>) {
  return <AD.Description className={cn("text-sm text-fg-muted", className)} {...props} />;
}

export function AlertDialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}

export function AlertDialogCancel({ className, ...props }: React.ComponentProps<typeof AD.Cancel>) {
  return <AD.Cancel className={cn(buttonVariants({ variant: "ghost" }), className)} {...props} />;
}

export function AlertDialogAction({
  className,
  danger,
  ...props
}: React.ComponentProps<typeof AD.Action> & { danger?: boolean }) {
  return (
    <AD.Action
      className={cn(buttonVariants({ variant: danger ? "danger" : "primary" }), className)}
      {...props}
    />
  );
}
