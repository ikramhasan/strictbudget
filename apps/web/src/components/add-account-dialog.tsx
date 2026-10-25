import { Button } from "@strictbudget/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@strictbudget/ui/components/dialog";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { CircleCheck } from "lucide-react";
import { useState } from "react";
import type { Budget } from "@/lib/budgets";
import { categoriesQueryOptions } from "@/lib/categories";
import { useCreateAccount } from "@/lib/use-create-account";
import { AddAccountForm } from "./account-forms";

/**
 * Adding an account shows a success step: "Add Another" starts over with an empty form, "Done"
 * closes and opens the new account.
 */
export function AddAccountDialog({
  budget,
  open,
  onOpenChange,
}: {
  budget: Budget;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const createAccount = useCreateAccount(budget.id);
  const categories = useQuery(categoriesQueryOptions(budget.id));
  /** The account just added: the success step is showing. */
  const [created, setCreated] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setCreated(null);
      setFormKey((k) => k + 1);
    }
  }

  async function done() {
    const accountId = created;
    handleOpenChange(false);
    if (accountId) {
      await navigate({
        to: "/budgets/$budgetId/accounts/$accountId",
        params: { budgetId: budget.id, accountId },
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Add account</DialogTitle>
              <DialogDescription className="sr-only">The account was added.</DialogDescription>
            </DialogHeader>
            <div className="grid justify-items-center gap-2 py-4 text-center">
              <CircleCheck className="size-8 text-green-600 dark:text-green-500" aria-hidden />
              <h3 className="font-semibold text-lg">Success!</h3>
              <p className="max-w-sm text-muted-foreground text-sm">
                Add transactions in the account's register as you spend and earn.
              </p>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setCreated(null);
                  setFormKey((k) => k + 1);
                }}
              >
                Add Another
              </Button>
              <Button onClick={() => void done()}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Add account</DialogTitle>
              <DialogDescription>
                Enter today's balance; strictbudget records it as the account's starting balance.
              </DialogDescription>
            </DialogHeader>
            <AddAccountForm
              key={formKey}
              settings={budget}
              categories={categories.data}
              onSubmit={async (values) => {
                const result = await createAccount(values);
                if ("error" in result) return result.error;
                setCreated(result.id);
                return null;
              }}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
