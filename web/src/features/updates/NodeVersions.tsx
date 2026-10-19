import { useQuery } from "@tanstack/react-query";
import { ArrowUpCircle, Box, Cpu, LoaderCircle, Sparkles } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useCan } from "@/app/useCurrentUser";
import { Button } from "@/components/ui/button";
import { nodeUpdatesQuery, releasesQuery } from "@/lib/queries";
import type { NodeDetail } from "@/lib/types";
import { UpdateDialog } from "./UpdateDialog";
import { availableUpdate, imageTag, updateButton } from "./updates";

type NodeRef = Pick<NodeDetail, "id" | "name" | "provisioning">;

function useVersions(node: NodeRef) {
  const updates = useQuery({ ...nodeUpdatesQuery(node.id), enabled: !node.provisioning });
  const current = updates.data?.current;
  const releases = useQuery({
    ...releasesQuery,
    enabled: !!current && (current.node_version !== null || current.tmnode_version !== null),
  });
  return {
    current,
    updates: updates.data?.updates,
    available: availableUpdate(current, releases.data?.enabled ? releases.data.latest : null),
  };
}

/** Версии ноды и tmnode в шапке карточки и бейдж «Доступно обновление». */
export function VersionChips({ node }: { node: NodeRef }) {
  const { t } = useTranslation();
  const { current, available } = useVersions(node);
  if (!current || (!current.node_image && !current.tmnode_version)) return null;
  const tag = imageTag(current.node_image);
  const imageTitle = current.node_image
    ? t(
        current.node_image_source === "report"
          ? "updates.chips.imageFromReport"
          : "updates.chips.image",
        { image: current.node_image },
      )
    : undefined;
  const chip =
    "inline-flex h-6 items-center gap-1 rounded-full border border-line bg-surface-2 px-2.5 font-mono text-[11px] text-fg-muted";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {current.node_image && (
        <span className={chip} title={imageTitle}>
          <Box className="size-3" aria-hidden />
          {current.node_version
            ? t("updates.chips.node", { version: `v${current.node_version}` })
            : t("updates.chips.node", { version: tag ?? t("updates.chips.unknown") })}
        </span>
      )}
      {current.tmnode_version && (
        <span className={chip}>
          <Cpu className="size-3" aria-hidden />
          {t("updates.chips.tmnode", { version: current.tmnode_version })}
        </span>
      )}
      {available && (
        <span className="inline-flex h-6 items-center gap-1 rounded-full border border-accent/40 bg-accent-soft px-2.5 text-[11px] font-medium text-fg">
          <Sparkles className="size-3 text-accent" aria-hidden />
          {t("updates.chips.available", { version: `v${available}` })}
        </span>
      )}
    </div>
  );
}

/** Кнопка «Обновить» и диалог; только admin+ и только у нод с агентом. */
export function UpdateAction({ node }: { node: NodeRef }) {
  const { t } = useTranslation();
  const canAdmin = useCan("admin");
  const { current, updates } = useVersions(node);
  const [open, setOpen] = React.useState(false);
  const button = updateButton(current, updates, canAdmin);
  if (button.kind === "hidden" || !current) return null;
  if (button.kind === "busy") {
    return (
      <Button variant="secondary" disabled title={t("updates.busyTitle")}>
        <LoaderCircle className="animate-spin" />
        {t("updates.busy")}
      </Button>
    );
  }
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <ArrowUpCircle />
        {t("updates.update")}
      </Button>
      <UpdateDialog node={node} current={current} open={open} onOpenChange={setOpen} />
    </>
  );
}
