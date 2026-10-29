import type { App } from "../app";

/**
 * Sample data for the demo user (`pnpm db:seed`, Railway PR environments): a USD budget with four
 * accounts and last month's and this month's paychecks, bills, spending, transfers and
 * assignments, so a preview opens on a budget that looks lived in. Everything goes through the
 * API as the demo user, so balances, payees and Ready to Assign are the app's own results.
 * Amounts are cents.
 */

const ACCOUNTS = [
  { key: "checking", name: "Checking", type: "checking", balance: "320000" },
  { key: "savings", name: "Savings", type: "savings", balance: "800000" },
  { key: "card", name: "Visa Card", type: "credit_card", balance: "-45000" },
  { key: "cash", name: "Wallet", type: "cash", balance: "12000" },
] as const;
type AccountKey = (typeof ACCOUNTS)[number]["key"];

/** One month's transactions; `day` is the day of the month. `category` matches a starter category. */
type Entry = { day: number; account: AccountKey; amount: string; memo?: string } & (
  | { payee: string; category: string | "income" }
  | { transferTo: AccountKey }
);
const MONTH: Entry[] = [
  { day: 1, account: "checking", amount: "160000", payee: "Acme Corp", category: "income" },
  { day: 1, account: "checking", amount: "-140000", payee: "Oakwood Apartments", category: "Rent" },
  { day: 3, account: "card", amount: "-8642", payee: "FreshMart", category: "Groceries" },
  { day: 5, account: "checking", amount: "-6500", payee: "Telco", category: "Phone" },
  { day: 6, account: "card", amount: "-3480", payee: "Luigi's", category: "Dining out" },
  { day: 8, account: "checking", amount: "-4500", payee: "Shell", category: "Transportation" },
  { day: 9, account: "cash", amount: "-1250", payee: "Corner Café", category: "Dining out" },
  { day: 10, account: "card", amount: "-1599", payee: "Netflix", category: "Entertainment" },
  { day: 11, account: "card", amount: "-11230", payee: "FreshMart", category: "Groceries" },
  { day: 12, account: "checking", amount: "-9800", payee: "City Power", category: "Utilities" },
  { day: 14, account: "checking", amount: "-30000", transferTo: "savings", memo: "Monthly saving" },
  { day: 15, account: "checking", amount: "160000", payee: "Acme Corp", category: "income" },
  { day: 17, account: "card", amount: "-5620", payee: "Pharmacy Plus", category: "Medical" },
  { day: 18, account: "card", amount: "-9375", payee: "FreshMart", category: "Groceries" },
  { day: 20, account: "checking", amount: "-45000", transferTo: "card", memo: "Card payment" },
  { day: 22, account: "card", amount: "-4210", payee: "Luigi's", category: "Dining out" },
  { day: 24, account: "checking", amount: "-4800", payee: "Shell", category: "Transportation" },
  { day: 26, account: "card", amount: "-7890", payee: "FreshMart", category: "Groceries" },
];

/** Last month's (the first month's) Assigned where it differs: the opening savings are the emergency fund. */
const FIRST_MONTH: Record<string, string> = { "Emergency fund": "850000" };

/** Assigned each month, by starter category name. */
const ASSIGN: Record<string, string> = {
  Rent: "140000",
  Phone: "6500",
  Utilities: "10000",
  Groceries: "45000",
  Transportation: "12000",
  Medical: "8000",
  "Emergency fund": "50000",
  "Dining out": "15000",
  Entertainment: "4000",
  Vacation: "20000",
};

type CategoryList = {
  readyToAssignCategoryId: string;
  groups: { kind: string | null; categories: { id: string; name: string }[] }[];
};

/** YYYY-MM-DD of `day` in the month `offset` months from `today`'s (UTC). */
function dayOf(today: Date, offset: number, day: number): string {
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + offset, day))
    .toISOString()
    .slice(0, 10);
}

/** Creates the sample budget as the user behind `cookie`; returns its id. */
export async function seedDemoBudget(app: App, cookie: string, now = new Date()): Promise<string> {
  const today = now.toISOString().slice(0, 10);
  const call = async <T>(method: string, path: string, body: unknown): Promise<T> => {
    const res = await app.request(path, {
      method,
      headers: { cookie, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  };

  const budget = await call<{ id: string }>("POST", "/v1/budgets", {
    name: "Demo Household",
    currency: "USD",
    numberFormat: "comma_dot",
    currencySymbolPosition: "before",
    dateFormat: "MM/DD/YYYY",
  });
  const base = `/v1/budgets/${budget.id}`;

  // Opened at the start of last month, so both months have history.
  const opened = dayOf(now, -1, 1);
  const accounts = {} as Record<AccountKey, string>;
  for (const { key, name, type, balance } of ACCOUNTS) {
    const account = await call<{ id: string }>("POST", `${base}/accounts`, {
      name,
      type,
      balance,
      date: opened,
    });
    accounts[key] = account.id;
  }

  const list = await call<CategoryList>("GET", `${base}/categories`, undefined);
  const categories = list.groups.filter((g) => !g.kind).flatMap((g) => g.categories);
  // Starter names carry an emoji ("🏠 Rent/Mortgage"); match on the words.
  const categoryId = (name: string) => {
    const found = categories.find((c) => c.name.includes(name));
    if (!found) throw new Error(`starter category "${name}" not found`);
    return found.id;
  };

  // Savings goals: keep a $10,000 emergency fund (rebuilt at most $500 a month), and save $1,500
  // for a holiday at $200 a month.
  const goals = [
    {
      name: "Emergency fund",
      behavior: "refill",
      goal: "safety_fund",
      amount: "50000",
      of: "1000000",
    },
    { name: "Vacation", behavior: "set_aside", goal: "save_up", amount: "20000", of: "150000" },
  ];
  for (const { name, behavior, goal, amount, of } of goals) {
    await call("PUT", `${base}/categories/${categoryId(name)}/target`, {
      cadence: "monthly",
      behavior,
      goal,
      amount,
      goalAmount: of,
      dueDay: null,
      month: dayOf(now, -1, 1).slice(0, 7),
      today,
    });
  }

  // The card's opening debt (450.00) has no spending behind it; assigning it to the card's payment
  // category last month covers the payment on the 20th.
  const payment = list.groups.find((g) => g.kind === "credit_card_payments")?.categories[0];
  if (payment) {
    await call("PUT", `${base}/months/${dayOf(now, -1, 1).slice(0, 7)}/categories/${payment.id}`, {
      assigned: "45000",
      today,
    });
  }

  for (const offset of [-1, 0]) {
    const month = dayOf(now, offset, 1).slice(0, 7);
    for (const [name, assigned] of Object.entries({
      ...ASSIGN,
      ...(offset === -1 ? FIRST_MONTH : {}),
    })) {
      await call("PUT", `${base}/months/${month}/categories/${categoryId(name)}`, {
        assigned,
        today,
      });
    }
    for (const entry of MONTH) {
      const date = dayOf(now, offset, entry.day);
      if (date > today) continue;
      const { account, amount, memo = "" } = entry;
      await call("POST", `${base}/transactions`, {
        accountId: accounts[account],
        date,
        amount,
        memo,
        // Last month's have cleared the bank; this month's are still pending.
        ...(offset === -1 ? { cleared: "cleared" } : {}),
        ...("transferTo" in entry
          ? { transferAccountId: accounts[entry.transferTo], categoryId: null }
          : {
              payeeName: entry.payee,
              categoryId:
                entry.category === "income"
                  ? list.readyToAssignCategoryId
                  : categoryId(entry.category),
            }),
      });
    }
  }
  return budget.id;
}
