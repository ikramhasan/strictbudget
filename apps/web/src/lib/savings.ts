import type { MoneyOption } from "./months";

type Format = (minorUnits: string) => string;

/**
 * Sources to take money from with savings categories last, together under "Savings", so spending
 * money is what's offered first.
 */
export function savingsLast(options: readonly MoneyOption[]): MoneyOption[] {
  return [
    ...options.filter((o) => !o.savings),
    ...options.filter((o) => o.savings).map((o) => ({ ...o, group: "Savings" })),
  ];
}

/**
 * What taking `amount` out of a savings category does, said before it happens, or null for a
 * spending category or nothing to take:
 * - a safety fund: "Emergency fund will be $200.00 below its $10,000.00, and its goal will ask for
 *   it back."
 * - a save-up goal: "Vacation's progress drops to $1,300.00 of $1,500.00."
 * - other savings: "This takes $200.00 out of the money you've set aside in Rainy day."
 */
export function savingsWarning(
  option: MoneyOption | undefined,
  amount: bigint,
  format: Format,
): string | null {
  const savings = option?.savings;
  if (!option || !savings || amount <= 0n) return null;
  const f = (value: bigint) => format(value.toString());
  const goal = savings.goal;
  if (goal?.kind === "safety_fund") {
    const after = BigInt(option.available) - amount;
    const short = goal.needed - after;
    if (short > 0n) {
      return `${option.name} will be ${f(short)} below its ${f(goal.needed)}, and its goal will ask for it back.`;
    }
  }
  if (goal?.kind === "save_up") {
    const after = goal.funded - amount;
    return `${option.name}'s progress drops to ${f(after > 0n ? after : 0n)} of ${f(goal.needed)}.`;
  }
  return `This takes ${f(amount)} out of the money you've set aside in ${option.name}.`;
}
