import { Button } from "@strictbudget/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@strictbudget/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@strictbudget/ui/components/dialog";
import { Field, FieldError, FieldLabel } from "@strictbudget/ui/components/field";
import { Input } from "@strictbudget/ui/components/input";
import { Spinner } from "@strictbudget/ui/components/spinner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { $api } from "@/lib/api";
import { apiErrorMessage, budgetsQueryOptions } from "@/lib/budgets";
import { refreshSession } from "@/lib/session";

/** Confirmed with the password; budgets the person owns are deleted with the account. */
export function DeleteAccountCard() {
  const [open, setOpen] = useState(false);
  return (
    // Card draws its edge with a ring, so the warning colour goes on the ring.
    <Card className="ring-destructive/40">
      <CardHeader>
        <CardTitle>Delete Account</CardTitle>
        <CardDescription>
          Delete your account if you no longer wish to use strictbudget (and want all of your
          account and budget data permanently deleted).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="destructive" onClick={() => setOpen(true)}>
          Delete Account
        </Button>
      </CardContent>
      {open && <DeleteAccountDialog onClose={() => setOpen(false)} />}
    </Card>
  );
}

function DeleteAccountDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const budgets = useQuery(budgetsQueryOptions());
  const remove = $api.useMutation("post", "/v1/me/delete");
  const [error, setError] = useState<string | null>(null);
  const owned = (budgets.data?.budgets ?? []).filter((b) => b.role === "owner");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    setError(null);
    try {
      await remove.mutateAsync({ body: { password } });
    } catch (e) {
      return setError(apiErrorMessage(e, "Couldn't delete the account. Try again."));
    }
    // The session went with the account.
    queryClient.clear();
    await refreshSession(queryClient);
    await navigate({ to: "/sign-in" });
    toast.success("Your account and its data were deleted.");
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>We're sorry to see you go!</DialogTitle>
            <DialogDescription>
              Looking to start over? You don't need to delete your account for that: make a fresh
              start with a budget, or create a new one.
            </DialogDescription>
          </DialogHeader>
          {owned.length > 0 && (
            <div className="grid gap-1 text-sm">
              <p>These budgets you own will be deleted, for everyone they're shared with:</p>
              <ul className="list-disc pl-5 text-muted-foreground">
                {owned.map((b) => (
                  <li key={b.id}>{b.name}</li>
                ))}
              </ul>
              <p className="text-muted-foreground">
                To keep a shared budget, make someone else its owner first (Budget settings →
                Sharing).
              </p>
            </div>
          )}
          <p className="text-sm">
            If you're sure you want to delete your account, confirm your password below. Your
            account and budget data will be permanently deleted.
          </p>
          <Field>
            <FieldLabel htmlFor="delete-password">Confirm Password</FieldLabel>
            <Input
              id="delete-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              autoFocus
            />
          </Field>
          {error && <FieldError>{error}</FieldError>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={remove.isPending}>
              {remove.isPending && <Spinner />} Delete Account
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
