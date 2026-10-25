import { Button } from "@strictbudget/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@strictbudget/ui/components/dropdown-menu";
import { LayoutTemplate, MoreHorizontal } from "lucide-react";

/** The budget list's less frequent options, behind "⋯" at the end of the views bar. */
export function BudgetOptionsMenu({
  onTemplates,
  progressBars,
  onProgressBarsChange,
}: {
  /** Opens the template gallery; left out for a viewer. */
  onTemplates?: () => void;
  progressBars: boolean;
  onProgressBarsChange: (on: boolean) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Budget options" title="Budget options">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {onTemplates && (
          <>
            <DropdownMenuItem onSelect={onTemplates}>
              <LayoutTemplate /> Templates
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuCheckboxItem checked={progressBars} onCheckedChange={onProgressBarsChange}>
          Progress bars
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
