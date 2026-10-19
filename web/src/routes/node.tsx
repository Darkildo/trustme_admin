import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Activity, History, Plug, Server, Settings2, SlidersHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConnectTab } from "@/features/nodes/ConnectTab";
import { HistoryTab } from "@/features/nodes/HistoryTab";
import { LimitsTab } from "@/features/nodes/LimitsTab";
import { NodeHeader } from "@/features/nodes/NodeHeader";
import { SettingsTab } from "@/features/nodes/SettingsTab";
import { StateTab } from "@/features/nodes/StateTab";
import type { NodeTab } from "@/features/nodes/tabs";
import { isApiError } from "@/lib/api";
import { nodeQuery } from "@/lib/queries";

export function NodePage({
  id,
  tab,
  onTab,
}: {
  id: string;
  tab: NodeTab;
  onTab: (tab: NodeTab) => void;
}) {
  const { t } = useTranslation();
  const q = useQuery(nodeQuery(id));

  if (q.isPending) {
    return (
      <div className="flex flex-col gap-5">
        <Skeleton className="h-44 rounded-xl" />
        <Skeleton className="h-10" />
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      </div>
    );
  }
  if (q.isError) {
    if (isApiError(q.error, "not_found")) {
      return (
        <EmptyState
          icon={Server}
          title={t("node.notFound")}
          text={t("node.notFoundText")}
          action={
            <Button asChild variant="secondary">
              <Link to="/nodes">{t("node.backToList")}</Link>
            </Button>
          }
        />
      );
    }
    return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  }

  const node = q.data;
  return (
    <div className="flex flex-col gap-5">
      <NodeHeader node={node} />
      <Tabs value={tab} onValueChange={(v) => onTab(v as NodeTab)}>
        <TabsList>
          <TabsTrigger value="state">
            <Activity aria-hidden />
            {t("node.tabs.state")}
          </TabsTrigger>
          <TabsTrigger value="history">
            <History aria-hidden />
            {t("node.tabs.history")}
          </TabsTrigger>
          <TabsTrigger value="connect">
            <Plug aria-hidden />
            {t("node.tabs.connect")}
          </TabsTrigger>
          <TabsTrigger value="limits">
            <SlidersHorizontal aria-hidden />
            {t("node.tabs.limits")}
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Settings2 aria-hidden />
            {t("node.tabs.settings")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="state">
          <StateTab node={node} onConnect={() => onTab("connect")} />
        </TabsContent>
        <TabsContent value="history">
          <HistoryTab nodeId={node.id} />
        </TabsContent>
        <TabsContent value="connect">
          <ConnectTab node={node} />
        </TabsContent>
        <TabsContent value="limits">
          <LimitsTab node={node} />
        </TabsContent>
        <TabsContent value="settings">
          <SettingsTab key={node.updated_at} node={node} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
