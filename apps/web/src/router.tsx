import type { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { ErrorScreen } from "./components/error-screen";
import { NotFound } from "./components/not-found";
import { routeTree } from "./routeTree.gen";

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: "intent",
    // Let TanStack Query own caching; the router always asks it.
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
    // The app shell's ScrollArea viewport scrolls the page, not the window.
    scrollToTopSelectors: ["#app-scroll"],
    defaultNotFoundComponent: () => <NotFound />,
    defaultErrorComponent: ({ error, reset }) => <ErrorScreen error={error} reset={reset} />,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
