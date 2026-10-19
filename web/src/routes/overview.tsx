import { useQuery } from "@tanstack/react-query";
import * as React from "react";
import { Plus, Server } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useUi } from "@/app/ui-context";
import { useCan } from "@/app/useCurrentUser";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Events } from "@/features/overview/Events";
import { Hero } from "@/features/overview/Hero";
import { LatencyChart } from "@/features/overview/LatencyChart";
import { Tiles } from "@/features/overview/Tiles";
import { nodesQuery, overviewQuery } from "@/lib/queries";

function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <Skeleton className="h-48 rounded-xl" />
      <div className="grid gap-5 xl:grid-cols-3">
        <div className="grid gap-3 sm:grid-cols-2 xl:col-span-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-28 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-80 rounded-lg" />
      </div>
    </div>
  );
}

export function OverviewPage() {
  const { t } = useTranslation();
  const q = useQuery(overviewQuery);
  const list = useQuery(nodesQuery).data;
  const provisioning = React.useMemo(
    () => new Set((list ?? []).filter((n) => n.provisioning).map((n) => n.id)),
    [list],
  );
  const canAdd = useCan("admin");
  const { openAddNode } = useUi();

  if (q.isPending) return <OverviewSkeleton />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;

  const data = q.data;
  if (data.nodes.total === 0) {
    return (
      <EmptyState
        icon={Server}
        title={t("overview.emptyTitle")}
        text={t("overview.emptyText")}
        className="mt-6 py-20"
        action={
          canAdd && (
            <Button variant="primary" size="lg" onClick={openAddNode}>
              <Plus />
              {t("nodes.add")}
            </Button>
          )
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Hero data={data} updatedAt={q.dataUpdatedAt} provisioning={provisioning.size} />
      <div className="grid gap-5 xl:grid-cols-3">
        <section aria-labelledby="tiles-title" className="flex flex-col gap-3 xl:col-span-2">
          <h2
            id="tiles-title"
            className="text-[13px] font-semibold tracking-wide text-fg-muted uppercase"
          >
            {t("overview.tiles")}
          </h2>
          <Tiles tiles={data.tiles} provisioning={provisioning} />
        </section>
        <Card className="xl:row-span-2">
          <CardHeader>
            <CardTitle>{t("overview.events")}</CardTitle>
          </CardHeader>
          <CardContent className="max-h-[560px] overflow-y-auto">
            <Events events={data.events} />
          </CardContent>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>{t("overview.latency")}</CardTitle>
            <span className="text-xs text-fg-subtle">{t("overview.latency24")}</span>
          </CardHeader>
          <CardContent>
            <LatencyChart points={data.latency} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
