import { Button } from "@strictbudget/ui/components/button";
import { Info } from "lucide-react";

export const REVIEW_SEARCH = "Is: Unapproved or Needs Category, ";

export function ReviewBanner({ count, onView }: { count: number; onView: () => void }) {
  if (count <= 0) return null;
  return (
    <section
      aria-label="Transactions to review"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-primary/10 px-4 py-2 text-sm"
    >
      <p className="flex items-center gap-2">
        <Info className="size-4 shrink-0" aria-hidden />
        {count} new {count === 1 ? "transaction" : "transactions"} to approve or categorize.
      </p>
      <Button size="sm" onClick={onView}>
        View
      </Button>
    </section>
  );
}
