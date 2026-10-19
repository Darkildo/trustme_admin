import { useTranslation } from "react-i18next";
import type { NodeUpdate } from "@/lib/types";

/** «нода v0.7.0 · tmnode 0.7.0» — что просили поставить. */
export function useTargetLabel() {
  const { t } = useTranslation();
  return (u: Pick<NodeUpdate, "node_version" | "tmnode_version">) =>
    [
      u.node_version && t("updates.targetNode", { version: u.node_version }),
      u.tmnode_version && t("updates.targetTmnode", { version: u.tmnode_version }),
    ]
      .filter(Boolean)
      .join(" · ");
}
