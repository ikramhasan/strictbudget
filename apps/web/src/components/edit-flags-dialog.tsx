import { Button } from "@strictbudget/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@strictbudget/ui/components/dialog";
import { Input } from "@strictbudget/ui/components/input";
import { cn } from "@strictbudget/ui/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { $api } from "@/lib/api";
import { apiErrorMessage } from "@/lib/budgets";
import { COLOR_LABEL, FLAG_CLASS, type Flag, flagsQueryOptions } from "@/lib/flags";

/** An empty name, or the color's own name, clears the flag's name back to the color. */
export function EditFlagsDialog({
  budgetId,
  open,
  onOpenChange,
}: {
  budgetId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit Flags</DialogTitle>
          <DialogDescription className="sr-only">
            Name the six flag colors for everyone on this budget.
          </DialogDescription>
        </DialogHeader>
        {open && <EditFlagsForm budgetId={budgetId} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

const shown = (flag: Flag) => flag.name || COLOR_LABEL[flag.color];

function EditFlagsForm({ budgetId, onClose }: { budgetId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const flags = useQuery(flagsQueryOptions(budgetId));
  const rename = $api.useMutation("put", "/v1/budgets/{budgetId}/flags/{color}");
  const [names, setNames] = useState<Record<string, string> | null>(null);
  const [pending, setPending] = useState(false);
  const list = flags.data?.flags ?? [];
  const values = names ?? Object.fromEntries(list.map((f) => [f.color, shown(f)]));

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const changes = list
      .map((f) => {
        const name = (values[f.color] ?? "").trim();
        return { color: f.color, name: name === COLOR_LABEL[f.color] ? "" : name };
      })
      .filter((change) => change.name !== list.find((f) => f.color === change.color)?.name);
    setPending(true);
    try {
      for (const { color, name } of changes) {
        await rename.mutateAsync({ params: { path: { budgetId, color } }, body: { name } });
      }
      onClose();
    } catch (e) {
      toast.error(apiErrorMessage(e, "Couldn't rename the flags."));
    } finally {
      setPending(false);
      if (changes.length > 0) {
        await queryClient.invalidateQueries({ queryKey: flagsQueryOptions(budgetId).queryKey });
      }
    }
  }

  return (
    <form onSubmit={(e) => void save(e)} className="grid gap-4">
      <div className="grid gap-2">
        {list.map((f) => (
          <div key={f.color} className="flex items-center gap-2">
            <Bookmark
              aria-hidden
              className={cn("size-5 shrink-0 fill-current", FLAG_CLASS[f.color])}
            />
            <Input
              aria-label={COLOR_LABEL[f.color]}
              placeholder={COLOR_LABEL[f.color]}
              value={values[f.color] ?? ""}
              onChange={(e) => setNames({ ...values, [f.color]: e.target.value })}
              maxLength={50}
            />
          </div>
        ))}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !flags.data}>
          Done
        </Button>
      </DialogFooter>
    </form>
  );
}
