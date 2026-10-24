import { Button } from "@strictbudget/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@strictbudget/ui/components/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@strictbudget/ui/components/tooltip";
import { cn } from "@strictbudget/ui/lib/utils";
import { format as formatDay } from "date-fns";
import { History } from "lucide-react";
import { useMemo, useState } from "react";
import { categoryMoveLines, type MoneyMove } from "@/lib/moves";
import { autoAssignMethodLabel } from "./auto-assign";
import { MemberAvatar } from "./member-avatar";

export interface CategoryMovesContext {
  /** The month's moves, every category's. */
  moves: readonly MoneyMove[];
  /** Category ids with a move this month: only these get the button. */
  withMoves: ReadonlySet<string>;
  /** A category's name by id, or a deleted one's kept name. */
  name: (id: string | null, deleted: string | null) => string;
  formatDate: (isoDate: string) => string;
  currentUserId: string | undefined;
}

/**
 * A category's history: a clock icon right of Assigned ("Changes to your assigned amount this
 * month") on a category with moves that month, shown while Assigned is hovered or the row is
 * selected. It opens "Moves": the date, the move, the amount from the category's side and who
 * made it, newest first.
 */
export function CategoryMovesButton({
  categoryId,
  categoryName,
  context,
  format,
  visible,
}: {
  categoryId: string;
  categoryName: string;
  context: CategoryMovesContext;
  format: (minorUnits: string) => string;
  /** Shown without hovering (the row is selected). */
  visible: boolean;
}) {
  const [open, setOpen] = useState(false);
  const lines = useMemo(
    () => (open ? categoryMoveLines(context.moves, categoryId, context.name) : []),
    [open, context, categoryId],
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Changes to ${categoryName}'s assigned amount this month`}
              className={cn(
                "size-6 text-primary-text opacity-0 focus-visible:opacity-100 group-hover/assigned:opacity-100",
                (visible || open) && "opacity-100",
              )}
            >
              <History className="size-4" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Changes to your assigned amount this month</TooltipContent>
      </Tooltip>
      <PopoverContent className="w-[min(34rem,calc(100vw-2rem))] p-4">
        <h2 className="font-semibold text-lg">Moves</h2>
        <p className="text-muted-foreground text-sm">{categoryName}</p>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground text-xs uppercase">
              <th className="py-1.5 pr-2 font-medium">Date</th>
              <th className="py-1.5 pr-2 font-medium">Move</th>
              <th className="py-1.5 pr-2 text-right font-medium">Amount</th>
              <th className="py-1.5">
                <span className="sr-only">Who</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map(({ move, label, method, amount }) => (
              <tr key={move.id} className="border-b">
                <td className="whitespace-nowrap py-2 pr-2">
                  {context.formatDate(formatDay(new Date(move.movedAt), "yyyy-MM-dd"))}
                </td>
                <td className="py-2 pr-2">
                  {label}
                  {method && (
                    <span className="ml-1 text-muted-foreground text-xs">
                      {autoAssignMethodLabel(method)}
                    </span>
                  )}
                </td>
                <td className="py-2 pr-2 text-right tabular-nums">{format(amount.toString())}</td>
                <td className="py-2">
                  <MemberAvatar
                    userId={move.userId}
                    userName={move.userName}
                    avatarColor={move.avatarColor}
                    picture={move.picture}
                    currentUserId={context.currentUserId}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 flex justify-end">
          <Button onClick={() => setOpen(false)}>Close</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
