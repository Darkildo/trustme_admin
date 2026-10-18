import { CircleCheck, CircleX, Info, X } from "lucide-react";
import { Toast as T } from "radix-ui";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { closeToast, useToasts } from "./toast-store";

const ICONS = { success: CircleCheck, error: CircleX, info: Info } as const;
const TONES = { success: "text-ok", error: "text-fail", info: "text-accent" } as const;

export function Toaster() {
  const list = useToasts();
  const { t } = useTranslation();
  return (
    <T.Provider swipeDirection="right" duration={5000}>
      {list.map((item) => {
        const Icon = ICONS[item.kind];
        return (
          <T.Root
            key={item.id}
            open={item.open}
            onOpenChange={(o) => {
              if (!o) closeToast(item.id);
            }}
            type={item.kind === "error" ? "foreground" : "background"}
            duration={item.kind === "error" ? 8000 : 5000}
            className={cn(
              "toast-root group pointer-events-auto relative flex w-full items-start gap-3 rounded-lg border border-line-strong bg-surface-2 p-3.5 pr-10 shadow-lg",
            )}
          >
            <Icon className={cn("mt-0.5 size-4.5 shrink-0", TONES[item.kind])} aria-hidden />
            <div className="min-w-0 flex-1">
              <T.Title className="text-sm font-medium text-fg">{item.title}</T.Title>
              {item.description && (
                <T.Description className="mt-0.5 font-mono text-xs break-all text-fg-muted">
                  {item.description}
                </T.Description>
              )}
            </div>
            <T.Close
              aria-label={t("common.close")}
              className="absolute top-2.5 right-2.5 rounded-sm p-1 text-fg-subtle hover:bg-surface-3 hover:text-fg"
            >
              <X className="size-3.5" />
            </T.Close>
          </T.Root>
        );
      })}
      <T.Viewport className="fixed right-0 bottom-[calc(var(--tm-bottomnav-h)+8px)] z-[100] m-0 flex w-full max-w-sm list-none flex-col gap-2 p-4 outline-none md:bottom-0" />
    </T.Provider>
  );
}
