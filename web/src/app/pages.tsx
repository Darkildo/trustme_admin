import { Outlet } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { FullPageLoader } from "./RouteStates";

// Secondary screens are split into their own chunks.
export const NodePage = lazy(() => import("@/routes/node").then((m) => ({ default: m.NodePage })));
export const LimitsPage = lazy(() =>
  import("@/routes/limits").then((m) => ({ default: m.LimitsPage })),
);
export const TurnPage = lazy(() => import("@/routes/turn").then((m) => ({ default: m.TurnPage })));
export const AuditPage = lazy(() =>
  import("@/routes/audit").then((m) => ({ default: m.AuditPage })),
);
export const UsersPage = lazy(() =>
  import("@/routes/users").then((m) => ({ default: m.UsersPage })),
);
export const SettingsPage = lazy(() =>
  import("@/routes/settings").then((m) => ({ default: m.SettingsPage })),
);
export const LoginPage = lazy(() =>
  import("@/routes/auth").then((m) => ({ default: m.LoginPage })),
);
export const SetupPage = lazy(() =>
  import("@/routes/auth").then((m) => ({ default: m.SetupPage })),
);
export const InvitePage = lazy(() =>
  import("@/routes/auth").then((m) => ({ default: m.InvitePage })),
);

export function RootComponent() {
  return (
    <Suspense fallback={<FullPageLoader />}>
      <Outlet />
    </Suspense>
  );
}
