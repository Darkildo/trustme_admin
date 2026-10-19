import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { parseNodeTab } from "@/features/nodes/tabs";
import { roleAtLeast } from "@/lib/auth";
import { meQuery, setupQuery } from "@/lib/queries";
import type { Role } from "@/lib/types";
import { NodesPage } from "@/routes/nodes";
import { OverviewPage } from "@/routes/overview";
import { AppShell } from "./AppShell";
import {
  AuditPage,
  InvitePage,
  LimitsPage,
  LoginPage,
  NodePage,
  RootComponent,
  SettingsPage,
  SetupPage,
  TurnPage,
  UsersPage,
} from "./pages";
import { FullPageLoader, NotFound, RouteError } from "./RouteStates";

export interface RouterContext {
  queryClient: QueryClient;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
  notFoundComponent: NotFound,
  errorComponent: RouteError,
  pendingComponent: FullPageLoader,
});

// ---- public routes ----

const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/setup",
  validateSearch: (s: Record<string, unknown>): { token?: string } => ({ token: str(s.token) }),
  component: function SetupRoute() {
    const { token } = setupRoute.useSearch();
    return <SetupPage token={token} />;
  },
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: (s: Record<string, unknown>): { next?: string } => ({ next: str(s.next) }),
  beforeLoad: async ({ context, search }) => {
    const setup = await context.queryClient.ensureQueryData(setupQuery);
    if (setup.needed) throw redirect({ to: "/setup", search: {} });
    const me = await context.queryClient.ensureQueryData(meQuery);
    if (me)
      throw redirect({
        to:
          search.next && search.next.startsWith("/") && !search.next.startsWith("//")
            ? search.next
            : "/",
      });
  },
  component: function LoginRoute() {
    const { next } = loginRoute.useSearch();
    return <LoginPage next={next} />;
  },
});

const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/invite",
  validateSearch: (s: Record<string, unknown>): { token?: string } => ({ token: str(s.token) }),
  component: function InviteRoute() {
    const { token } = inviteRoute.useSearch();
    return <InvitePage token={token} />;
  },
});

// ---- authenticated app ----

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  beforeLoad: async ({ context, location }) => {
    const setup = await context.queryClient.ensureQueryData(setupQuery);
    if (setup.needed) throw redirect({ to: "/setup", search: {} });
    const me = await context.queryClient.ensureQueryData(meQuery);
    if (!me) {
      const next = location.href === "/" ? undefined : location.href;
      throw redirect({ to: "/login", search: { next } });
    }
    return { me };
  },
  component: AppShell,
});

function requireRole(min: Role) {
  return ({ context }: { context: { me?: { role: Role } | null } }) => {
    if (!roleAtLeast(context.me?.role, min)) throw redirect({ to: "/" });
  };
}

const overviewRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  component: OverviewPage,
});
const nodesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/nodes",
  component: NodesPage,
});

const nodeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/nodes/$id",
  validateSearch: (s: Record<string, unknown>): { tab?: string } => ({
    tab: s.tab === undefined || s.tab === "state" ? undefined : parseNodeTab(s.tab),
  }),
  component: function NodeRoute() {
    const { id } = nodeRoute.useParams();
    const { tab } = nodeRoute.useSearch();
    const navigate = nodeRoute.useNavigate();
    return (
      <NodePage
        id={id}
        tab={parseNodeTab(tab)}
        onTab={(next) =>
          void navigate({ search: { tab: next === "state" ? undefined : next }, replace: true })
        }
      />
    );
  },
});

const limitsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/limits",
  validateSearch: (s: Record<string, unknown>): { profile?: string } => ({
    profile: str(s.profile),
  }),
  component: function LimitsRoute() {
    const { profile } = limitsRoute.useSearch();
    const navigate = limitsRoute.useNavigate();
    return (
      <LimitsPage
        selected={profile}
        onSelect={(id) => void navigate({ search: { profile: id }, replace: true })}
      />
    );
  },
});

const turnRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/turn",
  component: TurnPage,
});

const auditRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/audit",
  beforeLoad: requireRole("admin"),
  component: AuditPage,
});

const usersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/users",
  beforeLoad: requireRole("owner"),
  component: UsersPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/settings",
  component: SettingsPage,
});

const routeTree = rootRoute.addChildren([
  setupRoute,
  loginRoute,
  inviteRoute,
  appRoute.addChildren([
    overviewRoute,
    nodesRoute,
    nodeRoute,
    limitsRoute,
    turnRoute,
    auditRoute,
    usersRoute,
    settingsRoute,
  ]),
]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: false,
    defaultPendingMinMs: 0,
    defaultPendingMs: 300,
    scrollRestoration: true,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
