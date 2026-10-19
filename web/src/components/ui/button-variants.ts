import { cva } from "class-variance-authority";

export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap font-medium select-none transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out active:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-fg shadow-sm hover:bg-accent-hover hover:shadow-glow",
        secondary: "border border-line-strong bg-surface-2 text-fg hover:bg-surface-3",
        outline: "border border-line-strong bg-transparent text-fg hover:bg-surface-2",
        ghost: "text-fg-muted hover:bg-surface-2 hover:text-fg",
        danger: "bg-fail text-fg-inverse hover:opacity-90",
        "danger-outline": "border border-fail/40 text-fail hover:bg-fail-soft",
        link: "h-auto px-0 text-accent underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 rounded-sm px-3 text-[13px]",
        md: "h-9 rounded-md px-3.5 text-sm",
        lg: "h-11 rounded-md px-5 text-[15px]",
        icon: "size-9 rounded-md",
        "icon-sm": "size-8 rounded-sm",
      },
    },
    // Ссылке не нужны высота и отступы от size: иначе twMerge оставляет h-8 px-3.
    compoundVariants: [{ variant: "link", class: "h-auto px-0" }],
    defaultVariants: { variant: "secondary", size: "md" },
  },
);
