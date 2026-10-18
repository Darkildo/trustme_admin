import { Outlet, useRouterState } from "@tanstack/react-router";
import { motion } from "motion/react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@/components/ui/skeleton";
import { AddNodeWizard } from "@/features/nodes/AddNodeWizard";
import { storage } from "@/lib/utils";
import { CommandPalette } from "./CommandPalette";
import { BottomNav, Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { UiContext, type UiState } from "./ui-context";

const COLLAPSE_KEY = "tm-admin.sidebar-collapsed";

function PageSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true">
      <Skeleton className="h-40 rounded-xl" />
      <Skeleton className="h-10" />
      <Skeleton className="h-64" />
    </div>
  );
}

export function AppShell() {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = React.useState(() => storage.get(COLLAPSE_KEY) === "1");
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [addOpen, setAddOpen] = React.useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const ui = React.useMemo<UiState>(
    () => ({ openPalette: () => setPaletteOpen(true), openAddNode: () => setAddOpen(true) }),
    [],
  );

  return (
    <UiContext.Provider value={ui}>
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-accent px-3 py-2 text-accent-fg focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        {t("app.skipToContent")}
      </a>
      <div className="flex min-h-dvh">
        <Sidebar
          collapsed={collapsed}
          onToggle={() =>
            setCollapsed((c) => {
              storage.set(COLLAPSE_KEY, c ? "0" : "1");
              return !c;
            })
          }
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <main
            id="main"
            tabIndex={-1}
            className="flex-1 px-4 pt-5 pb-[calc(var(--tm-bottomnav-h)+24px)] outline-none sm:px-6 md:pb-10 lg:px-8"
          >
            <motion.div
              key={pathname}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="mx-auto w-full max-w-[1400px]"
            >
              <React.Suspense fallback={<PageSkeleton />}>
                <Outlet />
              </React.Suspense>
            </motion.div>
          </main>
        </div>
      </div>
      <BottomNav />
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onAddNode={() => setAddOpen(true)}
      />
      <AddNodeWizard open={addOpen} onOpenChange={setAddOpen} />
    </UiContext.Provider>
  );
}
