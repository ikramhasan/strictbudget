import { Button } from "@strictbudget/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@strictbudget/ui/components/empty";
import { Link } from "@tanstack/react-router";
import { PageTitle } from "./page-title";

export function NotFound() {
  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <PageTitle name="Page not found" />
      <Empty>
        <EmptyHeader>
          <EmptyTitle className="text-5xl tabular-nums">404</EmptyTitle>
          <EmptyDescription>This page doesn't exist.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild variant="outline">
            <Link to="/">Back to budget</Link>
          </Button>
        </EmptyContent>
      </Empty>
    </main>
  );
}
