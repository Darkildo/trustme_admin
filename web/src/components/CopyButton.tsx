import { Check, Copy } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button, type ButtonProps } from "@/components/ui/button";
import { toast } from "@/components/ui/toast-store";
import { copyText } from "@/lib/utils";

interface CopyButtonProps extends Omit<ButtonProps, "onClick"> {
  value: string;
  label?: string;
  /** Toast title on success; nothing is toasted when omitted. */
  toastTitle?: string;
  toastDescription?: string;
  showText?: boolean;
}

export function CopyButton({
  value,
  label,
  toastTitle,
  toastDescription,
  showText = false,
  variant = "ghost",
  size,
  ...props
}: CopyButtonProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(id);
  }, [copied]);

  const aria = label ?? t("common.copy");
  return (
    <Button
      variant={variant}
      size={size ?? (showText ? "sm" : "icon-sm")}
      aria-label={aria}
      title={aria}
      onClick={async (e) => {
        e.stopPropagation();
        const ok = await copyText(value);
        if (ok) {
          setCopied(true);
          if (toastTitle) toast.success(toastTitle, toastDescription);
        } else {
          toast.error(t("common.copyFailed"));
        }
      }}
      {...props}
    >
      {copied ? <Check className="text-ok" /> : <Copy />}
      {showText && <span>{copied ? t("common.copied") : t("common.copy")}</span>}
    </Button>
  );
}
