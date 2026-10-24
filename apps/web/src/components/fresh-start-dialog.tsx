import { Button } from "@strictbudget/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@strictbudget/ui/components/dialog";
import { Field, FieldDescription, FieldLabel } from "@strictbudget/ui/components/field";
import { Input } from "@strictbudget/ui/components/input";
import { type FormEvent, useId, useState } from "react";

export function FreshStartDialog({
  onContinue,
}: {
  /** Resolves once done, or once it failed and said so. */
  onContinue: (name: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const nameId = useId();
  const trimmed = name.trim();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!trimmed) return;
    setPending(true);
    try {
      await onContinue(trimmed);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setName("");
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">Make a fresh start</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(e) => void submit(e)} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Make a Fresh Start</DialogTitle>
            <DialogDescription>
              Starting fresh lets you start budgeting from today without setting up a brand new
              budget. A copy of this budget will be archived in case you're not happy with the
              changes.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor={nameId}>New budget name</FieldLabel>
            <Input
              id={nameId}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              autoFocus
            />
            <FieldDescription>Don't worry, you can always edit it later.</FieldDescription>
          </Field>
          <div className="grid gap-1 text-sm">
            <p className="font-medium">Here's what you'll see in your fresh start:</p>
            <ul className="list-disc pl-5 text-muted-foreground">
              <li>All your accounts, each starting with a $0 balance to update with today's</li>
              <li>Scheduled transactions</li>
              <li>Your category groups, categories, notes and targets</li>
            </ul>
            <p className="mt-2 font-medium">Your archived budget will keep:</p>
            <ul className="list-disc pl-5 text-muted-foreground">
              <li>Transaction histories for your accounts</li>
              <li>Category amounts</li>
            </ul>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!trimmed || pending}>
              Continue
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
