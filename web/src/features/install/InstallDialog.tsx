import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { runtimeQuery } from "@/lib/queries";
import { InstallPanel } from "./InstallPanel";

export interface InstallTarget {
  id: string;
  name: string;
  addr: string;
}

/** «host:port» → host (IPv6 brackets dropped). */
function hostOf(addr: string): string {
  const i = addr.lastIndexOf(":");
  const host = i > 0 ? addr.slice(0, i) : addr;
  return host.replace(/^\[(.*)\]$/, "$1");
}

function Body({ target, onClose }: { target: InstallTarget; onClose: () => void }) {
  const navigate = useNavigate();
  const rt = useQuery(runtimeQuery(target.id));
  if (rt.isPending) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-28" />
      </div>
    );
  }
  const provision = rt.data?.provision ?? null;
  return (
    <InstallPanel
      nodeId={target.id}
      publicHost={provision?.public_host ?? hostOf(target.addr)}
      withTurn={provision?.with_turn ?? false}
      onOpenNode={() => {
        onClose();
        void navigate({ to: "/nodes/$id", params: { id: target.id } });
      }}
    />
  );
}

/** Install a node that is waiting for its agent (from the list, card or overview). */
export function InstallDialog({
  target,
  onOpenChange,
}: {
  target: InstallTarget | null;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        {target && (
          <>
            <DialogHeader>
              <DialogTitle>{t("install.dialogTitle", { name: target.name })}</DialogTitle>
              <DialogDescription>{t("install.awaitingText")}</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <Body target={target} onClose={() => onOpenChange(false)} />
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                {t("common.close")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
