import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { ErrorScreen } from "@/components/error-screen";
import { NotFound } from "@/components/not-found";
import { instanceQueryOptions } from "@/lib/instance";

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  // Pages read it (`useInstance`) to leave out what needs email on a server that sends none.
  beforeLoad: ({ context }) => context.queryClient.ensureQueryData(instanceQueryOptions),
  component: RootLayout,
  // Above the app shell, so these get the whole window (and the brand).
  notFoundComponent: () => <NotFound fullPage />,
  errorComponent: ({ error, reset }) => <ErrorScreen error={error} reset={reset} fullPage />,
});

function RootLayout() {
  return (
    <>
      <Outlet />
      {import.meta.env.DEV && (
        <>
          <TanStackRouterDevtools position="bottom-right" />
          <ReactQueryDevtools buttonPosition="bottom-left" />
        </>
      )}
    </>
  );
}
