import { useNavigate } from "@tanstack/react-router";
import { Plug, Rocket, type LucideIcon } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NewServerFlow } from "@/features/install/NewServerFlow";
import { cn } from "@/lib/utils";
import { ExistingNodeFlow } from "./ExistingNodeFlow";

type Path = "new" | "existing";

function PathOption({
  value,
  current,
  onChange,
  icon: Icon,
  title,
  text,
  badge,
}: {
  value: Path;
  current: Path;
  onChange: (p: Path) => void;
  icon: LucideIcon;
  title: string;
  text: string;
  badge?: string;
}) {
  const id = React.useId();
  const checked = value === current;
  return (
    <label
      htmlFor={id}
      className={cn(
        "relative flex cursor-pointer gap-3 rounded-lg border px-3.5 py-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus",
        checked
          ? "border-accent/50 bg-accent-soft shadow-glow"
          : "border-line bg-surface-1 hover:border-line-strong hover:bg-surface-2",
      )}
    >
      <input
        id={id}
        type="radio"
        name="add-node-path"
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
        className="sr-only"
      />
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-md ring-1",
          checked
            ? "bg-gradient-brand text-accent-fg ring-accent/40"
            : "bg-surface-2 text-fg-muted ring-line-strong",
        )}
        aria-hidden
      >
        <Icon className="size-4" />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-fg">
          {title}
          {badge && (
            <span className="rounded-full border border-accent/35 bg-accent-soft px-1.5 text-[10px] font-semibold tracking-wide text-accent uppercase">
              {badge}
            </span>
          )}
        </span>
        <span className="text-xs text-fg-muted">{text}</span>
      </span>
    </label>
  );
}

/**
 * «Новая нода»: install on a fresh server through the agent (default) or connect an
 * already running node by address and pin.
 */
export function AddNodeWizard({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [session, setSession] = React.useState(0);
  const [path, setPath] = React.useState<Path>("new");
  const [created, setCreated] = React.useState<string | null>(null);

  const close = (o: boolean, go?: string) => {
    onOpenChange(o);
    if (o) return;
    const id = go ?? created;
    if (id) void navigate({ to: "/nodes/$id", params: { id } });
    window.setTimeout(() => {
      setSession((s) => s + 1);
      setPath("new");
      setCreated(null);
    }, 250);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => close(o)}>
      <DialogContent
        className="max-w-2xl"
        onInteractOutside={(e) => created !== null && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t("wizard.title")}</DialogTitle>
          <DialogDescription className={created ? "sr-only" : undefined}>
            {t("install.chooser")}
          </DialogDescription>
        </DialogHeader>
        {created === null && (
          <div
            role="radiogroup"
            aria-label={t("install.chooser")}
            className="grid gap-2 px-5 pt-3 sm:grid-cols-2"
          >
            <PathOption
              value="new"
              current={path}
              onChange={setPath}
              icon={Rocket}
              title={t("install.newServer")}
              text={t("install.newServerText")}
              badge={t("install.recommended")}
            />
            <PathOption
              value="existing"
              current={path}
              onChange={setPath}
              icon={Plug}
              title={t("install.existing")}
              text={t("install.existingText")}
            />
          </div>
        )}
        {path === "new" ? (
          <NewServerFlow
            key={`new-${session}`}
            onCreated={setCreated}
            onClose={() => close(false)}
            onOpenNode={(id) => close(false, id)}
          />
        ) : (
          <ExistingNodeFlow
            key={`existing-${session}`}
            onCreated={setCreated}
            onClose={() => close(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
