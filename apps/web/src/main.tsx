import { Toaster } from "@strictbudget/ui/components/sonner";
import { TooltipProvider } from "@strictbudget/ui/components/tooltip";
import { ThemeProvider } from "@strictbudget/ui/lib/theme";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { startErrorReporting } from "./lib/error-reporting";
import { createAppRouter } from "./router";
import "./styles.css";

startErrorReporting();

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});
const router = createAppRouter(queryClient);

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("#root element missing from index.html");

createRoot(rootElement).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </QueryClientProvider>
      {/* Above the register's floating selection bar, which sits at the bottom. */}
      <Toaster offset={{ bottom: "5.5rem" }} />
    </ThemeProvider>
  </StrictMode>,
);
