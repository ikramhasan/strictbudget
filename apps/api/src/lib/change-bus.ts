import type { Listen } from "@strictbudget/db";

/** A change to a budget's data, as the audit trigger notifies it (migration 0038). */
export interface BudgetChange {
  budgetId: string;
  table: string;
  actorId: string | null;
  /** The agent (`connected_agent` id) that made it for the actor; null for the actor's own. */
  agentId?: string | null;
  /** The browser tab that made it (`X-Client-Id`), so that tab can skip its own change. */
  clientId: string | null;
}

type Subscriber = (change: BudgetChange) => void;

/**
 * Live updates: one LISTEN on `budget_change` per API process, fanned out to the
 * budget's open event streams. Postgres sends a transaction's notifications at commit (identical
 * ones once), so streams only hear about changes that were kept, from every API process alike.
 * The LISTEN starts with the first subscriber.
 */
export class ChangeBus {
  readonly #subscribers = new Map<string, Set<Subscriber>>();
  #listening: Promise<unknown> | null = null;

  constructor(private readonly listen: Listen) {}

  /** Calls `onChange` for each change to the budget until the returned function is called. */
  async subscribe(budgetId: string, onChange: Subscriber): Promise<() => void> {
    this.#listening ??= this.listen("budget_change", (payload) => this.#publish(payload)).catch(
      (error: unknown) => {
        // The next subscriber tries again (the database may be back).
        this.#listening = null;
        throw error;
      },
    );
    await this.#listening;
    const set = this.#subscribers.get(budgetId) ?? new Set();
    set.add(onChange);
    this.#subscribers.set(budgetId, set);
    return () => {
      set.delete(onChange);
      if (set.size === 0) this.#subscribers.delete(budgetId);
    };
  }

  #publish(payload: string) {
    let change: BudgetChange;
    try {
      change = JSON.parse(payload) as BudgetChange;
    } catch {
      return;
    }
    for (const subscriber of this.#subscribers.get(change.budgetId) ?? []) subscriber(change);
  }
}
