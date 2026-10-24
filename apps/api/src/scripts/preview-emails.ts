import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { emails } from "../lib/email/templates";
import type { MonthlySummary } from "../lib/summary/data";
import { monthlySummaryEmail } from "../lib/summary/email";

/**
 * Writes every email, rendered with sample data, as HTML files for a look in a browser:
 * `pnpm --filter @strictbudget/api preview:emails <dir> [web origin]`. Images load from the web
 * origin (default: the dev server).
 */
const [dir = "email-previews", webOrigin = "http://localhost:5173"] = process.argv.slice(2);
mkdirSync(dir, { recursive: true });
const token = "k3Vq9XbT2mLw7RfZ8nHc4JpY6dGs1AeU";
const to = "dana@example.com";
const budget = {
  id: "budget",
  name: "Home budget",
  numberFormat: "comma_dot",
  currencySymbolPosition: "before",
  dateFormat: "DD/MM/YYYY",
} as const;
const summary: MonthlySummary = {
  month: "2026-10",
  currency: "USD",
  income: 642000n,
  spent: 518635n,
  previous: { income: 630000n, spent: 529357n },
  assigned: 642000n,
  readyToAssign: -14218n,
  groups: [
    { name: "Bills", spent: 231000n },
    { name: "Everyday", spent: 128452n },
    { name: "Fun", spent: 53825n },
    { name: "Irregular", spent: 43700n },
    { name: "Transport", spent: 41240n },
  ],
  overspent: [
    { name: "Groceries", assigned: 65000n, spent: 79218n, available: -14218n, credit: false },
    { name: "Gifts", assigned: 5000n, spent: 11200n, available: -6200n, credit: true },
  ],
  targets: {
    total: 9,
    funded: 7,
    partly: 1,
    short: [
      { name: "Car Insurance", funded: 36000n, needed: 60000n, dueDate: "2026-12-15" },
      { name: "New Laptop", funded: 0n, needed: 10000n, dueDate: null },
    ],
  },
  largest: [
    {
      payee: "Greenway Properties",
      date: "2026-10-01",
      category: "Rent",
      account: "Checking",
      amount: 165000n,
    },
    {
      payee: "City Power & Water",
      date: "2026-10-12",
      category: "Utilities",
      account: "Checking",
      amount: 21436n,
    },
    {
      payee: "FreshCo Market",
      date: "2026-10-19",
      category: "Groceries",
      account: "Visa",
      amount: 18840n,
    },
  ],
  categories: [],
  upcoming: {
    count: 4,
    items: [
      {
        payee: "Greenway Properties",
        date: "2026-11-01",
        category: "Rent",
        amount: -165000n,
        currency: "USD",
      },
      {
        payee: "Northwind Mobile",
        date: "2026-11-08",
        category: "Phone",
        amount: -4500n,
        currency: "USD",
      },
      {
        payee: "Streamly",
        date: "2026-11-14",
        category: "Subscriptions",
        amount: -1599n,
        currency: "USD",
      },
      {
        payee: "Paycheck · Acme Ltd",
        date: "2026-11-25",
        category: "Ready to Assign",
        amount: 321000n,
        currency: "USD",
      },
    ],
  },
};
const overview = {
  overview:
    "October ran over. Groceries and Gifts ended below zero by $204.18 in total. The $142.18 of cash overspending in Groceries comes out of November's Ready to Assign, so cover it first when you plan November.",
  points: [
    "Groceries has gone over its target in 3 of the last 4 months. Raising it from $650 to $720 would match what you actually spend.",
    "The Car Insurance target is due in December and is $240 short. $120 in each of the next two months covers it.",
  ],
};
const all = {
  "monthly-summary": monthlySummaryEmail({
    to,
    webOrigin,
    budget,
    summary,
    overview,
    unsubscribeUrl: `${webOrigin}/unsubscribe#token=${token}`,
    oneClickUrl: `${webOrigin}/v1/email/unsubscribe?token=${token}`,
  }),
  "verify-email": emails.verifyEmail(to, webOrigin, token),
  "change-email-confirm": emails.changeEmailConfirm(to, "dana.new@example.com", webOrigin, token),
  "change-email-verify": emails.changeEmailVerify("dana.new@example.com", webOrigin, token),
  "reset-password": emails.resetPassword(to, webOrigin, token),
  "existing-account": emails.existingAccount(to, webOrigin),
  "password-changed": emails.passwordChanged(to, webOrigin),
  "budget-invitation": emails.budgetInvitation(to, "sam@example.com", webOrigin, token),
  "budget-invitation-reminder": emails.invitationReminder(to, "sam@example.com", webOrigin, token),
};
for (const [name, message] of Object.entries(all)) {
  writeFileSync(join(dir, `${name}.html`), message.html);
  writeFileSync(join(dir, `${name}.txt`), `${message.subject}\n\n${message.text}\n`);
}
console.log(`Wrote ${Object.keys(all).length} emails to ${dir}`);
