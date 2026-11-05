import { Button } from "@strictbudget/ui/components/button";
import { Link, useRouter } from "@tanstack/react-router";
import { ArrowLeft, House } from "lucide-react";
import { StatusLayout } from "./error-screen";

/**
 * `fullPage` for a URL no route matches (no app shell around it); otherwise it fills the shell's
 * content area.
 */
export function NotFound({ fullPage = false }: { fullPage?: boolean }) {
  const router = useRouter();
  return (
    <StatusLayout fullPage={fullPage} title="Page not found">
      <div className="grid justify-items-center gap-4 text-center">
        <p className="font-semibold text-6xl text-primary-text tabular-nums tracking-tight">404</p>
        <div className="grid gap-1.5">
          <h1 className="font-semibold text-2xl tracking-tight">We can't find that page</h1>
          <p className="text-pretty text-muted-foreground">
            The link may be out of date, or the page may have moved.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button asChild>
          <Link to="/">
            <House /> Go to my budgets
          </Link>
        </Button>
        {router.history.canGoBack() && (
          <Button variant="outline" onClick={() => router.history.back()}>
            <ArrowLeft /> Go back
          </Button>
        )}
      </div>
    </StatusLayout>
  );
}
