import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, CircleMinus, KeyRound, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useCan } from "@/app/useCurrentUser";
import { CodeBlock } from "@/components/CodeBlock";
import { SecretOnce } from "@/components/SecretOnce";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/toast-store";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { qk } from "@/lib/queries";
import type { NodeDetail } from "@/lib/types";
import { buildCronCommand, panelOrigin } from "./cron";

export function ConnectTab({ node }: { node: NodeDetail }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const canRotate = useCan("admin");
  const [token, setToken] = useState<string | null>(null);

  const rotate = useMutation({
    mutationFn: () => api.nodes.rotateToken(node.id),
    onSuccess: (tok) => {
      setToken(tok);
      toast.success(t("connect.rotated"));
      void qc.invalidateQueries({ queryKey: qk.node(node.id) });
    },
    onError: (e) => toast.error(errorMessage(e, t)),
  });

  const command = buildCronCommand(token, panelOrigin());
  const steps = [t("connect.step1"), t("connect.step2"), t("connect.step3")];

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader>
          <CardTitle>{t("connect.title")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <p className="max-w-prose text-sm text-fg-muted">{t("connect.intro")}</p>
          <ol className="flex flex-col gap-2.5">
            {steps.map((s, i) => (
              <li key={i} className="flex items-start gap-3 text-sm text-fg">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-gradient-brand font-mono text-xs font-semibold text-accent-fg">
                  {i + 1}
                </span>
                <span className="pt-0.5">{s}</span>
              </li>
            ))}
          </ol>
          {token && (
            <SecretOnce
              label={t("connect.newToken")}
              value={token}
              warning={t("connect.tokenOnce")}
            />
          )}
          <CodeBlock code={command} label={t("connect.command")} />
          {!token && <p className="text-xs text-fg-subtle">{t("connect.placeholderNote")}</p>}
        </CardContent>
      </Card>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle>{t("wizard.tokenTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="flex items-center gap-2 text-sm text-fg">
            {node.has_ingest_token ? (
              <CircleCheck className="size-4 text-ok" aria-hidden />
            ) : (
              <CircleMinus className="size-4 text-skip" aria-hidden />
            )}
            {node.has_ingest_token ? t("connect.tokenActive") : t("connect.tokenNone")}
          </p>
          {canRotate && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="secondary" disabled={rotate.isPending}>
                  {rotate.isPending ? <RefreshCw className="animate-spin" /> : <KeyRound />}
                  {rotate.isPending ? t("connect.rotating") : t("connect.rotate")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogTitle>{t("connect.rotateTitle")}</AlertDialogTitle>
                <AlertDialogDescription>{t("connect.rotateText")}</AlertDialogDescription>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => rotate.mutate()}>
                    {t("connect.rotateConfirm")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
