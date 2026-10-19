import type * as React from "react";
import { cn } from "@/lib/utils";

export const fieldBase =
  "w-full rounded-md border border-line-strong bg-bg-elevated px-3 text-sm text-fg placeholder:text-fg-subtle shadow-sm transition-[border-color,box-shadow] duration-150 focus-visible:outline-offset-0 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-fail";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input data-slot="input" className={cn(fieldBase, "h-9", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(fieldBase, "min-h-20 py-2 leading-relaxed", className)}
      {...props}
    />
  );
}
