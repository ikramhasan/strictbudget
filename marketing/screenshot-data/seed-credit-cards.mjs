// Seeds the "Nadia & Sam" budget for the credit card post's screenshots (`/blog/credit-cards`) as
// the demo user, through a local API (never the hosted app). Amounts are cents. It stops in the
// state before the October fix (Dining out $24.50 overspent on the Visa); run it again with `fix`
// to move the money. TODAY must be the capture date's October (dates are fixed to 2026).
//
//   COOKIE_FILE=<file holding the demo user's session cookie> node seed-credit-cards.mjs
//   COOKIE_FILE=… node seed-credit-cards.mjs fix
import { readFileSync } from "node:fs";

const API = "http://localhost:3000";
const ORIGIN = "http://localhost:5173";
const TODAY = "2026-10-28";
const LOGOS = new URL("./logos/", import.meta.url);

const cookie = readFileSync(process.env.COOKIE_FILE, "utf8").trim().replace(/;$/, "");

async function call(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

const NAME = "Nadia & Sam";
const existing = await call("GET", "/v1/budgets");
const list = Array.isArray(existing) ? existing : (existing.budgets ?? existing.data ?? []);
const mode = process.argv[2];

if (mode === "fix") {
  const b = list.find((x) => x.name === NAME);
  const base = `/v1/budgets/${b.id}`;
  const cats = await call("GET", `${base}/categories`);
  const all = cats.groups.flatMap((g) => g.categories);
  const id = (n) => all.find((c) => c.name.includes(n)).id;
  await call("POST", `${base}/months/2026-10/moves`, {
    fromCategoryId: id("Stuff I forgot"),
    toCategoryId: id("Dining out"),
    amount: "2450",
    today: TODAY,
  });
  console.log("moved $24.50 to Dining out");
  process.exit(0);
}

for (const b of list.filter((x) => x.name === NAME)) {
  await fetch(`${API}/v1/budgets/${b.id}`, { method: "DELETE", headers: { cookie, origin: ORIGIN } });
}

const budget = await call("POST", "/v1/budgets", {
  name: NAME,
  currency: "USD",
  numberFormat: "comma_dot",
  currencySymbolPosition: "before",
  dateFormat: "MM/DD/YYYY",
});
const base = `/v1/budgets/${budget.id}`;
console.log("budget", budget.id);

const OPENED = "2026-04-01";
const ACCOUNTS = [
  { key: "checking", name: "Checking", type: "checking", balance: "320000", logo: "northwind" },
  { key: "savings", name: "Savings", type: "savings", balance: "650000", logo: "northwind" },
  { key: "visa", name: "Juniper", type: "credit_card", balance: "0", logo: "juniper" },
  { key: "mc", name: "Harbor", type: "credit_card", balance: "-420000", logo: "harbor" },
];
const acct = {};
for (const a of ACCOUNTS) {
  const created = await call("POST", `${base}/accounts`, {
    name: a.name,
    type: a.type,
    balance: a.balance,
    date: OPENED,
  });
  acct[a.key] = created.id;
  const form = new FormData();
  form.append("file", new Blob([readFileSync(new URL(`${a.logo}.png`, LOGOS))], { type: "image/png" }), `${a.logo}.png`);
  const res = await fetch(`${API}${base}/accounts/${created.id}/logo`, {
    method: "PUT",
    headers: { cookie, origin: ORIGIN },
    body: form,
  });
  if (!res.ok) throw new Error(`logo ${a.name}: ${res.status} ${await res.text()}`);
}

// Categories: the starters plus a few, each with a target.
let cats = await call("GET", `${base}/categories`);
const groupId = (name) => cats.groups.find((g) => g.name === name).id;
await call("POST", `${base}/categories`, { groupId: groupId("Bills"), name: "🎬 Streaming" });
await call("POST", `${base}/categories`, { groupId: groupId("Needs"), name: "💳 Interest & Fees" });
await call("POST", `${base}/categories`, { groupId: groupId("Wants"), name: "👟 Clothing" });
cats = await call("GET", `${base}/categories`);
const allCats = () => cats.groups.flatMap((g) => g.categories.map((c) => ({ ...c, kind: g.kind })));
const cat = (n) => {
  const c = allCats().find((x) => x.name.includes(n));
  if (!c) throw new Error(`no category ${n}`);
  return c.id;
};
const payment = (cardName) => {
  const g = cats.groups.find((x) => x.kind === "credit_card_payments");
  return g.categories.find((c) => c.name.includes(cardName)).id;
};

// [category, monthly amount] in cents; set_aside monthly targets.
const MONTHLY = [
  ["Rent", 165000, 1],
  ["Phone & Internet", 13500, 8],
  ["Utilities", 11000, 12],
  ["Streaming", 1599, 5],
  ["Groceries", 60000, null],
  ["Transportation", 12000, null],
  ["Medical", 4000, null],
  ["Dining out", 12000, null],
  ["Entertainment", 4000, null],
  ["Vacation", 20000, null],
  ["Stuff I forgot", 5000, null],
  ["strictbudget", 800, 3],
  ["Clothing", 6000, null],
];
const REFILL = ["Groceries", "Transportation", "Dining out", "Entertainment"];
for (const [n, amount, dueDay] of MONTHLY) {
  await call("PUT", `${base}/categories/${cat(n)}/target`, { month: "2026-04",
    cadence: "monthly",
    behavior: REFILL.includes(n) ? "refill" : "set_aside",
    amount: String(amount),
    dueDay,
  });
}
await call("PUT", `${base}/categories/${cat("Interest & Fees")}/target`, { month: "2026-04",
  cadence: "monthly",
  behavior: "refill",
  amount: "9000",
  dueDay: 3,
});
await call("PUT", `${base}/categories/${cat("Emergency fund")}/target`, { month: "2026-04",
  cadence: "custom",
  behavior: "balance",
  amount: "2000000",
  dueDate: "2027-06-30",
  repeat: null,
}).catch(async (e) => {
  console.warn("emergency target:", e.message.slice(0, 200));
});
await call("PUT", `${base}/categories/${payment("Harbor")}/target`, { month: "2026-04",
  cadence: "payment_monthly",
  amount: "30000",
});
await call("PUT", `${base}/expected-income`, { amount: "495000" });

// Transactions.
const tx = (account, date, amount, payeeName, category, memo = "") =>
  call("POST", `${base}/transactions`, {
    accountId: acct[account],
    date,
    amount: String(amount),
    memo,
    cleared: date < "2026-10-20" ? "cleared" : "uncleared",
    payeeName,
    categoryId: category === "income" ? cats.readyToAssignCategoryId : cat(category),
  });
const transfer = (from, to, date, amount, memo = "") =>
  call("POST", `${base}/transactions`, {
    accountId: acct[from],
    date,
    amount: String(-amount),
    memo,
    cleared: date < "2026-10-20" ? "cleared" : "uncleared",
    transferAccountId: acct[to],
    categoryId: null,
  });

// Visa spending by month (Apr–Sep); October is spelled out below.
const VISA = {
  "04": [[3, -9412, "FreshMart", "Groceries"], [6, -3150, "Luigi's", "Dining out"], [7, -4825, "Ridgeway Fuel", "Transportation"], [5, -1599, "Streamly", "Streaming"], [11, -13877, "FreshMart", "Groceries"], [14, -2600, "Lumen Cinema", "Entertainment"], [18, -12240, "FreshMart", "Groceries"], [20, -4410, "Casa Verde", "Dining out"], [22, -5190, "Ridgeway Fuel", "Transportation"], [26, -15634, "FreshMart", "Groceries"], [28, -4799, "Thread & Co", "Clothing"]],
  "05": [[2, -11023, "FreshMart", "Groceries"], [5, -1599, "Streamly", "Streaming"], [8, -5512, "Ridgeway Fuel", "Transportation"], [9, -3880, "Luigi's", "Dining out"], [13, -14390, "FreshMart", "Groceries"], [17, -2980, "Lumen Cinema", "Entertainment"], [20, -13115, "FreshMart", "Groceries"], [23, -5025, "Hana Sushi", "Dining out"], [24, -4975, "Ridgeway Fuel", "Transportation"], [29, -12866, "FreshMart", "Groceries"]],
  "06": [[1, -12510, "FreshMart", "Groceries"], [5, -1599, "Streamly", "Streaming"], [6, -4630, "Ridgeway Fuel", "Transportation"], [7, -2745, "Casa Verde", "Dining out"], [12, -15122, "FreshMart", "Groceries"], [14, -8999, "Stride Shoes", "Clothing"], [19, -13640, "FreshMart", "Groceries"], [21, -5865, "Luigi's", "Dining out"], [24, -5302, "Ridgeway Fuel", "Transportation"], [27, -11408, "FreshMart", "Groceries"]],
  "07": [[2, -13350, "FreshMart", "Groceries"], [4, -3420, "Luigi's", "Dining out"], [5, -1599, "Streamly", "Streaming"], [9, -5120, "Ridgeway Fuel", "Transportation"], [10, -14215, "FreshMart", "Groceries"], [16, -3200, "Lumen Cinema", "Entertainment"], [17, -12780, "FreshMart", "Groceries"], [19, -4960, "Hana Sushi", "Dining out"], [23, -5440, "Ridgeway Fuel", "Transportation"], [28, -14102, "FreshMart", "Groceries"]],
  "08": [[1, -11870, "FreshMart", "Groceries"], [5, -1599, "Streamly", "Streaming"], [6, -4985, "Ridgeway Fuel", "Transportation"], [8, -3615, "Casa Verde", "Dining out"], [9, -13960, "FreshMart", "Groceries"], [15, -6450, "Thread & Co", "Clothing"], [16, -12345, "FreshMart", "Groceries"], [22, -5210, "Luigi's", "Dining out"], [25, -5068, "Ridgeway Fuel", "Transportation"], [27, -15020, "FreshMart", "Groceries"]],
  "09": [[3, -12644, "FreshMart", "Groceries"], [5, -1599, "Streamly", "Streaming"], [6, -4410, "Luigi's", "Dining out"], [8, -5233, "Ridgeway Fuel", "Transportation"], [11, -14518, "FreshMart", "Groceries"], [13, -2850, "Lumen Cinema", "Entertainment"], [18, -13207, "FreshMart", "Groceries"], [20, -5175, "Casa Verde", "Dining out"], [23, -4890, "Ridgeway Fuel", "Transportation"], [27, -12750, "FreshMart", "Groceries"], [29, -4815, "Thread & Co", "Clothing"]],
};
const OCT_VISA = [
  [2, -8617, "FreshMart", "Groceries"],
  [4, -3840, "Luigi's", "Dining out"],
  [5, -1599, "Streamly", "Streaming"],
  [7, -5230, "Ridgeway Fuel", "Transportation"],
  [9, -8999, "Stride Shoes", "Clothing"],
  [11, -2715, "Casa Verde", "Dining out"],
  [12, -14283, "FreshMart", "Groceries"],
  [16, 8999, "Stride Shoes", "Clothing", "Returned: wrong size"],
  [18, -5445, "Luigi's", "Dining out"],
  [19, -11856, "FreshMart", "Groceries"],
  [22, -4875, "Ridgeway Fuel", "Transportation"],
  [24, -2450, "Hana Sushi", "Dining out"],
  [26, -9741, "FreshMart", "Groceries"],
];
const CHECKING = (mm) => [
  [1, 247500, "Brightline Studio", "income"],
  [1, -165000, "Maple Court Apartments", "Rent"],
  [8, -13500, "Clearwave", "Phone & Internet"],
  [12, mm === "07" || mm === "08" ? -12840 : -9875, "City Power", "Utilities"],
  [15, 247500, "Coastal Health", "income"],
  [3, -800, "strictbudget", "strictbudget"],
  ...(mm === "05" ? [[14, -3500, "Elm Street Pharmacy", "Medical"]] : []),
  ...(mm === "08" ? [[19, -6000, "Dr. Okafor", "Medical"]] : []),
  ...(mm === "10" ? [[17, -2250, "Elm Street Pharmacy", "Medical"]] : []),
];

const RATE = 0.2499; // Harbor Mastercard APR, for the interest charges.
let harbor = 420000;
let visaPrev = 0;
const MONTHS = ["04", "05", "06", "07", "08", "09", "10"];
for (const mm of MONTHS) {
  const month = `2026-${mm}`;
  const d = (day) => `${month}-${String(day).padStart(2, "0")}`;
  for (const [day, amount, payee, category] of CHECKING(mm)) await tx("checking", d(day), amount, payee, category);
  const visa = mm === "10" ? OCT_VISA : VISA[mm];
  let visaTotal = 0;
  for (const [day, amount, payee, category, memo] of visa) {
    await tx("visa", d(day), amount, payee, category, memo);
    visaTotal += -amount;
  }
  await transfer("checking", "savings", d(16), 140000, "Monthly saving");
  // Last month's Visa statement, paid on the 21st.
  if (visaPrev > 0) await transfer("checking", "visa", d(21), visaPrev, "Statement balance");
  visaPrev = visaTotal;
  // Harbor: interest on the 3rd, $300 plus the interest paid on the 20th.
  const interest = Math.round((harbor * RATE) / 12);
  await tx("mc", d(3), -interest, "Harbor Bank", "Interest & Fees", "Interest charge");
  await transfer("checking", "mc", d(20), 30000 + interest, "Payment");
  harbor -= 30000;

  // Assign: targets, then the rest to the emergency fund.
  await call("POST", `${base}/months/${month}/auto-assign`, { option: "underfunded", today: TODAY }).catch(
    async (e) => {
      console.warn("auto-assign:", e.message.slice(0, 300));
    },
  );
  // Auto-assign covers overspending; October keeps Dining out at its $120.00 refill, so the
  // $24.50 at Hana Sushi on the 24th shows as credit overspending.
  if (mm === "10") {
    await call("PUT", `${base}/months/${month}/categories/${cat("Dining out")}`, {
      assigned: "9585",
      today: TODAY,
    });
  }
  await call("PUT", `${base}/months/${month}/categories/${payment("Harbor")}`, {
    assigned: "30000",
    today: TODAY,
  });
  const m = await call("GET", `${base}/months/${month}?today=${TODAY}`);
  const rta = BigInt(m.readyToAssign);
  if (rta > 0n) {
    const ef = m.categories.find((c) => c.categoryId === cat("Emergency fund"));
    const already = ef ? BigInt(ef.assigned) : 0n;
    await call("PUT", `${base}/months/${month}/categories/${cat("Emergency fund")}`, {
      assigned: String(already + rta),
      today: TODAY,
    });
  }
  console.log(month, "RTA before rest", String(rta), "harbor owes", harbor + 30000, "→", harbor, "interest", interest);
}
console.log("done", budget.id);
