import type * as React from "react";
import { ToggleGroup } from "radix-ui";
import { cn } from "@/lib/utils";

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ value: T; label: React.ReactNode }>;
  label: string;
  className?: string;
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: SegmentedProps<T>) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      aria-label={label}
      onValueChange={(v) => {
        if (v) onChange(v as T);
      }}
      className={cn(
        "inline-flex rounded-md border border-line-strong bg-bg-elevated p-0.5",
        className,
      )}
    >
      {options.map((o) => (
        <ToggleGroup.Item
          key={o.value}
          value={o.value}
          className="inline-flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-[13px] font-medium text-fg-muted transition-colors hover:text-fg data-[state=on]:bg-surface-3 data-[state=on]:text-fg data-[state=on]:shadow-sm [&_svg]:size-3.5"
        >
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
