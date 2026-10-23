import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Navigate, RouterProvider, createBrowserRouter, createHashRouter, useLocation, type RouteObject } from "react-router";
import { MazeLoader } from "@emb/ui";
import { ApiError } from "./api/http.ts";
import { useMe } from "./api/queries.ts";
import { PrefsProvider, useT } from "./i18n/index.tsx";
import { ClinicProvider } from "./lib/clinic.tsx";
import { SetupMfaPage, SignInPage, VerifyPage } from "./routes/auth.tsx";
import { ComingSoonPage, LoadError, MorePage, NotFoundPage, PatientPage, PatientsPage, SettingsPage, TodayPage } from "./routes/pages.tsx";
import { ClinicShell } from "./shell/ClinicShell.tsx";

/**
 * Staff-only area. /v1/me decides: 401 → sign in (and come back here),
 * 403 mfa_required → enrolment, otherwise the shell.
 */
export function RequireStaff() {
  const me = useMe();
  const location = useLocation();
  const t = useT();
  if (me.isPending) {
    return (
      <div className="app-fullpage">
        <MazeLoader label={t("common.loading")} />
      </div>
    );
  }
  if (me.isError) {
    const e = me.error;
    if (e instanceof ApiError && e.status === 401) {
      return <Navigate to={`/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
    }
    if (e instanceof ApiError && e.status === 403 && e.code === "mfa_required") return <Navigate to="/setup-mfa" replace />;
    return (
      <div className="app-fullpage app-fullpage--pad">
        <LoadError error={e} retry={() => void me.refetch()} />
      </div>
    );
  }
  return (
    <ClinicProvider memberships={me.data.memberships}>
      <ClinicShell me={me.data} />
    </ClinicProvider>
  );
}

export const routes: RouteObject[] = [
  { path: "/", element: <Navigate to="/today" replace /> },
  { path: "/sign-in", element: <SignInPage /> },
  { path: "/sign-in/verify", element: <VerifyPage /> },
  { path: "/setup-mfa", element: <SetupMfaPage /> },
  {
    element: <RequireStaff />,
    children: [
      { path: "/today", element: <TodayPage /> },
      { path: "/patients", element: <PatientsPage /> },
      { path: "/patients/:id", element: <PatientPage /> },
      { path: "/calendar", element: <ComingSoonPage area="calendar" /> },
      { path: "/protocols", element: <ComingSoonPage area="protocols" /> },
      { path: "/library", element: <ComingSoonPage area="library" /> },
      { path: "/messages", element: <ComingSoonPage area="messages" /> },
      { path: "/reports", element: <ComingSoonPage area="reports" /> },
      { path: "/settings", element: <SettingsPage /> },
      { path: "/more", element: <MorePage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];

export function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } });
}

export function App({ queryClient = makeQueryClient(), hashRouting = false }: { queryClient?: QueryClient; hashRouting?: boolean }) {
  const [router] = useState(() => (hashRouting ? createHashRouter : createBrowserRouter)(routes));
  return (
    <PrefsProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </PrefsProvider>
  );
}

