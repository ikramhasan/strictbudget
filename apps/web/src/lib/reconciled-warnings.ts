import type { UpdateTransactionBody } from "./transaction-history";
import type { Transaction } from "./transactions";

/**
 * Warnings before a change that can put a reconciliation out of balance. Reconciled transactions
 * stay reconciled (there's no unreconciling), so these are the only guard.
 */
export interface ReconciledWarning {
  title: string;
  paragraphs: string[];
  confirm: string;
}

/**
 * The warning before saving `body` on `t`, if any. A transfer whose other side is reconciled
 * warns when its amount, payee or account changes (the other side follows); a reconciled
 * transaction warns when its amount or account changes. Memo, date, category, flag and split
 * lines save without one.
 */
export function editWarning(
  t: Transaction,
  body: UpdateTransactionBody,
  accountName: (id: string) => string,
): ReconciledWarning | null {
  const moved = body.accountId !== undefined && body.accountId !== t.accountId;
  const amountChanged = body.amount !== undefined && body.amount !== t.amount;
  const payeeChanged =
    (body.transferAccountId !== undefined && body.transferAccountId !== t.transferAccountId) ||
    (body.payeeName !== undefined && t.transferAccountId !== null);
  if (t.transferReconciled && t.transferAccountId && (moved || amountChanged || payeeChanged)) {
    const other = accountName(t.transferAccountId);
    return {
      title: "Save Changes to Reconciled Transfer",
      paragraphs: [
        `This transfer has already been reconciled in ${other}.`,
        `Any changes to this transaction will automatically modify the matching, reconciled transaction in ${other} and may bring the reconciliation out of balance.`,
      ],
      confirm: moved ? "Move" : "Save",
    };
  }
  if (t.cleared !== "reconciled") return null;
  if (moved) {
    return {
      title: "Move Reconciled Transaction",
      paragraphs: [
        "Moving this reconciled transaction to another account will bring the reconciliation out of balance.",
      ],
      confirm: "Move",
    };
  }
  if (amountChanged) {
    return {
      title: "Save Changes to Reconciled Transaction",
      paragraphs: [
        "Saving your changes to this reconciled transaction may bring your reconciliation out of balance.",
      ],
      confirm: "Save",
    };
  }
  return null;
}

/** What a delete covers: how many transactions, how many reconciled, how many with reconciled transfers. */
export interface DeleteScope {
  count: number;
  reconciled: number;
  reconciledTransfers: number;
}

export function rowDeleteScope(t: Transaction): DeleteScope {
  return {
    count: 1,
    reconciled: t.cleared === "reconciled" ? 1 : 0,
    reconciledTransfers:
      t.transferReconciled || t.subtransactions.some((l) => l.transferReconciled) ? 1 : 0,
  };
}

/**
 * The warning before deleting, if any. A plain delete (even of a transfer) has none; a reconciled
 * transfer elsewhere takes precedence over a reconciled row here.
 */
export function deleteWarning(scope: DeleteScope): ReconciledWarning | null {
  const several = `Delete ${scope.count} Transactions?`;
  if (scope.reconciledTransfers > 0) {
    return {
      title: scope.count === 1 ? "Delete Reconciled Transfer?" : several,
      paragraphs: [
        "Deleting a transfer transaction will delete the transfer in both accounts.",
        "Some matching transfers in other accounts have been reconciled. Deleting these transactions could bring those account's reconciliations out of balance.",
      ],
      confirm: "Delete",
    };
  }
  if (scope.reconciled > 0) {
    return {
      title: scope.count === 1 ? "Delete Reconciled Transaction?" : several,
      paragraphs: [
        "Deleting a reconciled transaction will bring the reconciliation out of balance.",
      ],
      confirm: "Delete",
    };
  }
  return null;
}
