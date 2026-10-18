import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./styles/globals.css";
import "./i18n";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { MotionConfig } from "motion/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toast";
import { toast } from "@/components/ui/toast-store";
import i18n from "./i18n";
import { createAppRouter } from "./app/router";
import { ApiError, setUnauthorizedHandler } from "./lib/api";
import { qk } from "./lib/queries";
import { applyTheme, getTheme } from "./lib/theme";

applyTheme(getTheme());

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) =>
        !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
      refetchOnWindowFocus: true,
      staleTime: 5_000,
    },
  },
  mutationCache: new MutationCache(),
});

const router = createAppRouter(queryClient);

let redirecting = false;
setUnauthorizedHandler(() => {
  if (redirecting) return;
  const path = router.state.location.pathname;
  if (path === "/login" || path === "/setup" || path === "/invite") return;
  redirecting = true;
  queryClient.clear();
  queryClient.setQueryData(qk.me, null);
  toast.info(i18n.t("auth.sessionExpired"));
  void router
    .navigate({ to: "/login", search: { next: router.state.location.href } })
    .finally(() => {
      redirecting = false;
    });
});

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <TooltipProvider delayDuration={300}>
          <RouterProvider router={router} />
          <Toaster />
        </TooltipProvider>
      </MotionConfig>
    </QueryClientProvider>
  </StrictMode>,
);
