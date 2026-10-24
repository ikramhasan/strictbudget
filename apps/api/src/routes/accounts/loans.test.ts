import { loanTerms } from "@strictbudget/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBudget, createTestApp, resetDatabase, signUp } from "../../../test/helpers";

const { app, db, close } = createTestApp();
beforeEach(() => resetDatabase(db));
afterAll(close);

type Account = {
  id: string;
  name: string;
  interestRate: string | null;
  balances: { cleared: string; uncleared: string; working: string };
  pairedCategoryId: string | null;
  lastPaymentDate: string | null;
  lastPaymentFromAccountId: string | null;
};
type Charge = { total: string; applied: string; status: string; editedAt: string | null };
type LoanMonth = {
  month: string;
  startBalance: string;
  endBalance: string;
  payments: string;
  interest: Charge;
  escrow: Charge;
  transactions: Array<{ amount: string; kind: string; fromAccountId: string | null }>;
};
type Txn = {
  date: string;
  amount: string;
  payeeName: string | null;
  categoryName: string | null;
  cleared: string;
  memo: string;
};
type Group = {
  id: string;
  name: string;
  kind: string | null;
  categories: Array<{ id: string; name: string; internalKind?: string | null }>;
};

const TODAY = "2026-10-13";

function send(method: string, path: string, cookie: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** $100,000 at 5.125%, $900 a month, $150 escrow, July 1. */
async function setup() {
  const { cookie } = await signUp(app);
  const budget = await createBudget(app, cookie);
  const base = `/v1/budgets/${budget.id}`;
  const addAccount = async (input: Record<string, unknown>): Promise<Account> => {
    const res = await send("POST", `${base}/accounts`, cookie, { date: "2026-07-01", ...input });
    expect(res.status, await res.clone().text()).toBe(201);
    return (await res.json()) as Account;
  };
  const groups = async () =>
    ((await (await send("GET", `${base}/categories`, cookie)).json()) as { groups: Group[] })
      .groups;
  const bills = (await groups()).find((g) => g.kind === null && g.categories.length > 0);
  const payCategory = bills?.categories[0];
  if (!payCategory) throw new Error("No category to pair");
  const checking = await addAccount({ name: "L7 Chk", type: "checking", balance: "2000000" });
  const mortgage = await addAccount({
    name: "L7 Mortgage",
    type: "mortgage",
    balance: "-10000000",
    interestRate: "5.125",
    minimumPayment: "90000",
    escrowAmount: "15000",
    pairedCategoryId: payCategory.id,
  });
  const account = async (id: string) =>
    (
      (await (await send("GET", `${base}/accounts?today=${TODAY}`, cookie)).json()) as {
        accounts: Account[];
      }
    ).accounts.find((a) => a.id === id);
  const pay = async (date: string, amount: string, memo = "", loanId = mortgage.id) => {
    const res = await send("POST", `${base}/accounts/${loanId}/loan/payments`, cookie, {
      fromAccountId: checking.id,
      amount,
      date,
      memo,
    });
    expect(res.status, await res.clone().text()).toBe(201);
  };
  const months = async (loanId = mortgage.id) => {
    const res = await send("GET", `${base}/accounts/${loanId}/loan?today=${TODAY}`, cookie);
    expect(res.status, await res.clone().text()).toBe(200);
    return ((await res.json()) as { months: LoanMonth[] }).months;
  };
  const setCharge = (month: string, kind: string, amount: string, loanId = mortgage.id) =>
    send("PUT", `${base}/accounts/${loanId}/loan/charges`, cookie, {
      month,
      kind,
      amount,
      today: TODAY,
    });
  const transactions = async (accountId: string) =>
    (
      (await (await send("GET", `${base}/transactions?accountId=${accountId}`, cookie)).json()) as {
        transactions: Txn[];
      }
    ).transactions;
  return {
    cookie,
    base,
    addAccount,
    groups,
    payCategory,
    checking,
    mortgage,
    account,
    pay,
    months,
    setCharge,
    transactions,
  };
}

describe("loan activity", () => {
  it("reports the account of the payment entered last, not the latest-dated one", async () => {
    const { cookie, base, addAccount, checking, mortgage, account, pay } = await setup();
    expect((await account(mortgage.id))?.lastPaymentFromAccountId).toBeNull();

    await pay("2026-09-05", "90000");
    expect((await account(mortgage.id))?.lastPaymentFromAccountId).toBe(checking.id);
    expect((await account(checking.id))?.lastPaymentFromAccountId).toBeNull();

    // A payment back-dated before the others still becomes the default.
    const savings = await addAccount({ name: "Savings", type: "savings", balance: "500000" });
    const res = await send("POST", `${base}/accounts/${mortgage.id}/loan/payments`, cookie, {
      fromAccountId: savings.id,
      amount: "1000",
      date: "2026-08-01",
      memo: "",
    });
    expect(res.status, await res.clone().text()).toBe(201);
    expect((await account(mortgage.id))?.lastPaymentFromAccountId).toBe(savings.id);
  });

  it("schedules a payment dated after today, once", async () => {
    const { cookie, base, checking, mortgage, payCategory, account, transactions } = await setup();
    const res = await send(
      "POST",
      `${base}/accounts/${mortgage.id}/loan/payments?today=${TODAY}`,
      cookie,
      { fromAccountId: checking.id, amount: "1000", date: "2026-10-14", memo: "x-future" },
    );
    expect(res.status, await res.clone().text()).toBe(201);
    // Nothing entered yet: the balance is the opening one, and neither register has the payment.
    expect((await res.json()) as Account).toMatchObject({
      balances: { working: "-10000000" },
    });
    expect((await transactions(mortgage.id)).map((t) => t.memo)).not.toContain("x-future");
    expect((await transactions(checking.id)).map((t) => t.memo)).not.toContain("x-future");
    const scheduled = (
      (await (
        await send("GET", `${base}/scheduled-transactions?today=${TODAY}`, cookie)
      ).json()) as {
        scheduledTransactions: Array<{
          kind: string;
          accountId: string;
          frequency: string;
          dateNext: string;
          amount: string;
          categoryId: string | null;
          transferAccountId: string | null;
          memo: string;
        }>;
      }
    ).scheduledTransactions.filter((s) => s.memo === "x-future");
    expect(scheduled.find((s) => s.kind === "schedule")).toMatchObject({
      accountId: mortgage.id,
      frequency: "never",
      dateNext: "2026-10-14",
      amount: "1000",
      categoryId: payCategory.id,
      transferAccountId: checking.id,
    });
    expect(scheduled.find((s) => s.kind === "transfer")).toMatchObject({
      accountId: checking.id,
      amount: "-1000",
    });
    expect((await account(mortgage.id))?.balances.working).toBe("-10000000");

    // On its date it's entered like any schedule.
    const later = await send("GET", `${base}/scheduled-transactions?today=2026-10-14`, cookie);
    expect(later.status).toBe(200);
    expect((await transactions(checking.id)).find((t) => t.memo === "x-future")).toMatchObject({
      date: "2026-10-14",
      amount: "-1000",
    });
  });

  it("lists this month's upcoming payments, every occurrence", async () => {
    const { cookie, base, checking, mortgage, payCategory } = await setup();
    const record = async (date: string, amount: string, memo: string) => {
      const res = await send(
        "POST",
        `${base}/accounts/${mortgage.id}/loan/payments?today=${TODAY}`,
        cookie,
        { fromAccountId: checking.id, amount, date, memo },
      );
      expect(res.status, await res.clone().text()).toBe(201);
    };
    await record("2026-10-20", "2000", "x-a");
    await record("2026-10-28", "3000", "x-b");
    // Next month's isn't listed.
    await record("2026-11-05", "4000", "x-c");
    // A weekly payment entered in the checking register: each occurrence left in October.
    const weekly = await send("POST", `${base}/scheduled-transactions`, cookie, {
      accountId: checking.id,
      frequency: "weekly",
      date: "2026-10-22",
      amount: "-500",
      transferAccountId: mortgage.id,
      categoryId: payCategory.id,
      memo: "x-w",
      today: TODAY,
    });
    expect(weekly.status, await weekly.clone().text()).toBe(201);
    // A transfer out of the loan isn't a payment.
    const out = await send("POST", `${base}/scheduled-transactions`, cookie, {
      accountId: mortgage.id,
      date: "2026-10-25",
      amount: "-700",
      transferAccountId: checking.id,
      memo: "x-out",
      today: TODAY,
    });
    expect(out.status, await out.clone().text()).toBe(201);

    const res = await send("GET", `${base}/accounts/${mortgage.id}/loan?today=${TODAY}`, cookie);
    const body = (await res.json()) as {
      months: LoanMonth[];
      upcoming: Array<Record<string, string>>;
    };
    expect(
      body.upcoming.map((u) => [u.date, u.amount, u.memo, u.accountName, u.payeeName]),
    ).toEqual([
      ["2026-10-29", "500", "x-w", "L7 Chk", "Transfer : L7 Mortgage"],
      ["2026-10-28", "3000", "x-b", "L7 Mortgage", "Transfer : L7 Chk"],
      ["2026-10-22", "500", "x-w", "L7 Chk", "Transfer : L7 Mortgage"],
      ["2026-10-20", "2000", "x-a", "L7 Mortgage", "Transfer : L7 Chk"],
    ]);
    const recorded = body.upcoming.find((u) => u.memo === "x-a");
    expect(recorded).toMatchObject({ payingAccountId: checking.id });
    expect(recorded?.payingRowId).toBe(`${recorded?.scheduleId}~${checking.id}`);
    const fromChecking = body.upcoming.find((u) => u.memo === "x-w");
    expect(fromChecking?.payingRowId).toBe(fromChecking?.scheduleId);
    // Not in the month's payments or balance.
    expect(body.months.at(-1)).toMatchObject({ month: "2026-10", payments: "0" });

    // Once today passes one, it's no longer upcoming.
    const later = await send(
      "GET",
      `${base}/accounts/${mortgage.id}/loan?today=2026-10-23`,
      cookie,
    );
    const after = (await later.json()) as { upcoming: Array<{ date: string }> };
    expect(after.upcoming.map((u) => u.date)).toEqual(["2026-10-29", "2026-10-28"]);
  });

  it("reports the account a credit card was last paid from, another card included", async () => {
    const { cookie, base, addAccount, checking, account } = await setup();
    const card = await addAccount({ name: "Visa", type: "credit_card", balance: "-5000" });
    const other = await addAccount({ name: "Amex", type: "credit_card", balance: "0" });
    const transfer = async (from: string, to: string, date: string) => {
      const res = await send("POST", `${base}/transactions`, cookie, {
        accountId: from,
        date,
        amount: "-1000",
        payeeName: null,
        transferAccountId: to,
        categoryId: null,
        memo: "",
      });
      expect(res.status, await res.clone().text()).toBe(201);
    };
    expect((await account(card.id))?.lastPaymentFromAccountId).toBeNull();
    await transfer(checking.id, card.id, "2026-10-05");
    expect((await account(card.id))?.lastPaymentFromAccountId).toBe(checking.id);
    // A transfer from another card entered later becomes the default; a cash advance goes the other
    // way and doesn't.
    await transfer(other.id, card.id, "2026-10-06");
    expect((await account(card.id))?.lastPaymentFromAccountId).toBe(other.id);
    await transfer(card.id, checking.id, "2026-10-07");
    expect((await account(card.id))?.lastPaymentFromAccountId).toBe(other.id);
    expect((await account(checking.id))?.lastPaymentFromAccountId).toBeNull();
    // The one entered last counts, even back-dated before the others.
    await transfer(checking.id, card.id, "2026-10-01");
    expect((await account(card.id))?.lastPaymentFromAccountId).toBe(checking.id);
  });

  it("charges escrow and interest on the months with payments", async () => {
    const { mortgage, checking, payCategory, account, pay, months, transactions } = await setup();
    await pay("2026-08-05", "90000", "x-aug");
    await pay("2026-09-05", "90000");
    await pay("2026-09-20", "50000");

    const all = await months();
    expect(all.map((m) => m.month)).toEqual(["2026-07", "2026-08", "2026-09", "2026-10"]);
    const [jul, aug, sep, oct] = all;
    expect(jul?.interest.applied).toBe("0");
    expect(aug).toMatchObject({
      payments: "90000",
      interest: { total: "42708", applied: "42708", status: "estimated" },
      escrow: { total: "15000", applied: "15000", status: "estimated" },
      endBalance: "-9967708",
    });
    expect(sep).toMatchObject({ interest: { applied: "42570" }, endBalance: "-9885278" });
    expect(oct?.payments).toBe("0");
    expect(aug?.transactions).toEqual([
      expect.objectContaining({ amount: "90000", kind: "payment", fromAccountId: checking.id }),
    ]);

    // Payments are cleared on the loan's side; the charges aren't.
    expect((await account(mortgage.id))?.balances).toEqual({
      cleared: "-9770000",
      uncleared: "-115278",
      working: "-9885278",
    });
    expect((await account(mortgage.id))?.lastPaymentDate).toBe("2026-09-20");
    // The paying side comes out of the paired category, uncleared.
    expect((await transactions(checking.id)).find((t) => t.memo === "x-aug")).toMatchObject({
      amount: "-90000",
      payeeName: "Transfer : L7 Mortgage",
      categoryName: payCategory.name,
      cleared: "uncleared",
    });
  });

  it("rounds interest twice and lists the loan's terms ($2,074.97 → $10.38)", async () => {
    const { base, cookie, addAccount, pay } = await setup();
    const half = await addAccount({
      name: "L7 Half",
      type: "personal_loan",
      balance: "-207497",
      interestRate: "6",
      minimumPayment: "100",
    });
    await pay("2026-08-10", "5000", "", half.id);
    const res = await send("GET", `${base}/accounts/${half.id}/loan?today=${TODAY}`, cookie);
    const body = (await res.json()) as {
      months: LoanMonth[];
      terms: Array<{ month: string; interestRate: string | null; minimumPayment: string | null }>;
    };
    // $10.37485 rounds to $10.375, then $10.38 (one rounding gave $10.37).
    expect(body.months[1]?.interest).toMatchObject({ total: "1038", applied: "1038" });
    expect(body.terms).toEqual([
      expect.objectContaining({ interestRate: "6.000", minimumPayment: "100", escrowAmount: null }),
    ]);
  });

  it("edits, deletes and adds to a month's interest and escrow", async () => {
    const { mortgage, account, pay, months, setCharge } = await setup();
    await pay("2026-09-05", "90000");

    expect((await setCharge("2026-09", "interest", "43000")).status).toBe(200);
    let sep = (await months())[2];
    expect(sep?.interest).toMatchObject({ total: "43000", applied: "43000", status: "edited" });
    expect(sep?.interest.editedAt).not.toBeNull();
    expect((await account(mortgage.id))?.balances.working).toBe(
      String(-10_000_000 + 90_000 - 43_000 - 15_000),
    );

    // Delete Interest stores $0, not the estimate.
    await setCharge("2026-09", "interest", "0");
    sep = (await months())[2];
    expect(sep?.interest).toMatchObject({ total: "0", applied: "0", status: "edited" });

    // A recorded amount applies without payments (accrued interest).
    await setCharge("2026-10", "interest", "1000");
    await setCharge("2026-10", "escrow", "500");
    const oct = (await months())[3];
    expect(oct?.interest.applied).toBe("1000");
    expect(oct?.escrow.applied).toBe("500");

    expect((await setCharge("2026-06", "interest", "100")).status).toBe(400);
    expect((await setCharge("2026-11", "interest", "100")).status).toBe(400);
    expect((await setCharge("2026-09", "interest", "-1")).status).toBe(400);
  });

  it("applies new terms from the month they're set in", async () => {
    const { base, cookie, mortgage, pay, months } = await setup();
    await pay("2026-09-05", "90000");
    await pay("2026-10-05", "90000");
    const res = await send("PATCH", `${base}/accounts/${mortgage.id}`, cookie, {
      interestRate: "6",
      date: TODAY,
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const [, , sep, oct] = await months();
    expect(sep?.interest.applied).toBe("42708"); // still 5.125% on $100,000
    // 6% on what September left: 100,000 − 900 + 427.08 + 150 = $99,677.08 → $498.39.
    expect(oct?.interest.applied).toBe("49839");
  });

  it("keeps a pre-7f loan's old terms for earlier months", async () => {
    const { base, cookie, mortgage, pay, months } = await setup();
    // Older loans have no loan_terms rows, only the account's columns.
    await db.delete(loanTerms).where(eq(loanTerms.accountId, mortgage.id));
    await pay("2026-09-05", "90000");
    await pay("2026-10-05", "90000");
    expect((await months())[2]?.interest.applied).toBe("42708");
    await send("PATCH", `${base}/accounts/${mortgage.id}`, cookie, {
      interestRate: "6",
      date: TODAY,
    });
    const [, , sep, oct] = await months();
    expect(sep?.interest.applied).toBe("42708"); // still 5.125%
    expect(oct?.interest.applied).toBe("49839"); // 6% from October
  });

  it("keeps escrow to mortgages", async () => {
    const { base, cookie, addAccount, mortgage } = await setup();
    const car = await addAccount({
      name: "Car",
      type: "auto_loan",
      balance: "-500000",
      escrowAmount: "1000",
    });
    expect((car as Account & { escrowAmount: string | null }).escrowAmount).toBeNull();
    const res = await send("PATCH", `${base}/accounts/${mortgage.id}`, cookie, {
      type: "personal_loan",
      date: TODAY,
    });
    expect(((await res.json()) as { escrowAmount: string | null }).escrowAmount).toBeNull();
  });

  it("fixes the charges at Update Balance", async () => {
    const { base, cookie, mortgage, pay, months, transactions } = await setup();
    await pay("2026-07-10", "50000");
    await pay("2026-09-05", "90000");
    const res = await send("POST", `${base}/accounts/${mortgage.id}/reconcile`, cookie, {
      balance: "-9900000",
      date: TODAY,
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const after = (await res.json()) as Account;
    expect(after.balances.working).toBe("-9900000");
    expect(after.balances.uncleared).toBe("0");
    expect((await transactions(mortgage.id)).every((t) => t.cleared === "reconciled")).toBe(true);

    const [jul, aug, sep] = await months();
    // July's capped interest is kept at what was applied; August had no payment, so no lines.
    expect(jul?.interest).toMatchObject({ applied: "35000", status: "reconciled" });
    expect(jul?.escrow).toMatchObject({ applied: "15000", status: "reconciled" });
    expect(aug?.interest.status).toBe("estimated");
    expect(sep?.interest.status).toBe("reconciled");

    // A new rate doesn't change reconciled months.
    await send("PATCH", `${base}/accounts/${mortgage.id}`, cookie, {
      interestRate: "12",
      date: TODAY,
    });
    expect((await months())[2]?.interest.applied).toBe(sep?.interest.applied);
  });

  describe("Update Balance's interest rate / escrow check", () => {
    /** $100,000 from Sep 1, 6%, $900, $150 escrow; $900 on Sep 15, Oct 5. */
    async function x126() {
      const s = await setup();
      const loan = await s.addAccount({
        name: "x-126-Mort",
        type: "mortgage",
        date: "2026-09-01",
        balance: "-10000000",
        interestRate: "6",
        minimumPayment: "90000",
        escrowAmount: "15000",
      });
      await s.pay("2026-09-15", "90000", "x-126-pay", loan.id);
      await s.pay("2026-10-05", "90000", "x-126-pay", loan.id);
      const body = (loanTerms?: unknown) => ({ balance: "-9940000", date: TODAY, loanTerms });
      const preview = async (loanTerms?: unknown) => {
        const res = await send(
          "POST",
          `${s.base}/accounts/${loan.id}/reconcile/preview`,
          s.cookie,
          body(loanTerms),
        );
        expect(res.status, await res.clone().text()).toBe(200);
        return ((await res.json()) as { adjustment: string }).adjustment;
      };
      const reconcile = async (loanTerms?: unknown) => {
        const res = await send(
          "POST",
          `${s.base}/accounts/${loan.id}/reconcile`,
          s.cookie,
          body(loanTerms),
        );
        expect(res.status, await res.clone().text()).toBe(200);
        return (await res.json()) as Account & { escrowAmount: string | null };
      };
      const accountOn = async (today: string) =>
        (
          (await (await send("GET", `${s.base}/accounts?today=${today}`, s.cookie)).json()) as {
            accounts: Array<Account & { escrowAmount: string | null }>;
          }
        ).accounts.find((a) => a.id === loan.id);
      const terms = async () =>
        (
          (await (
            await send("GET", `${s.base}/accounts/${loan.id}/loan?today=${TODAY}`, s.cookie)
          ).json()) as { terms: Array<{ month: string; interestRate: string | null }> }
        ).terms;
      return { ...s, loan, preview, reconcile, accountOn, terms };
    }

    it("re-estimates this month on a new rate kept going forward", async () => {
      const { loan, preview, reconcile, months, terms, accountOn } = await x126();
      expect((await accountOn(TODAY))?.balances.working).toBe("-9949875");
      // The check step's Difference: $98.75; the Changes step's after 6% → 7%: $181.88.
      expect(await preview()).toBe("9875");
      const rate7 = { interestRate: { rate: "7", keepGoingForward: true } };
      expect(await preview(rate7)).toBe("18188");
      expect(await preview({ interestRate: { rate: "6.000", keepGoingForward: false } })).toBe(
        "9875",
      );

      const after = await reconcile(rate7);
      // October's interest stays at the old $498.75: −$99,498.75 + $181.88 = −$99,316.87.
      expect(after.balances.working).toBe("-9931687");
      expect(after.interestRate).toBe("7.000");
      const [sep, oct] = await months(loan.id);
      expect(sep?.interest).toMatchObject({ applied: "50000", status: "reconciled" });
      expect(oct?.interest).toMatchObject({ applied: "49875", status: "reconciled" });
      expect(oct?.transactions.map((t) => t.amount)).toContain("18188");
      // September keeps 6%; October on is 7%.
      expect((await terms()).map((t) => [t.month, t.interestRate])).toEqual([
        ["2026-09", "6.000"],
        ["2026-10", "7.000"],
      ]);
      expect((await accountOn("2027-01-15"))?.interestRate).toBe("7.000");
    });

    it("brings the old rate back next month when not kept", async () => {
      const { reconcile, terms, accountOn } = await x126();
      const after = await reconcile({ interestRate: { rate: "7", keepGoingForward: false } });
      expect(after.balances.working).toBe("-9931687");
      expect(after.interestRate).toBe("7.000");
      expect((await terms()).map((t) => [t.month, t.interestRate])).toEqual([
        ["2026-09", "6.000"],
        ["2026-10", "7.000"],
        ["2026-11", "6.000"],
      ]);
      expect((await accountOn("2026-11-02"))?.interestRate).toBe("6.000");
    });

    it("keeps earlier months' terms when the only entry is this month's", async () => {
      // The loan added in October, its starting balance moved back to September.
      const s = await setup();
      const loan = await s.addAccount({
        name: "x-126-Late",
        type: "mortgage",
        date: TODAY,
        balance: "-10000000",
        interestRate: "6",
        minimumPayment: "90000",
        escrowAmount: "15000",
      });
      const [start] = (await s.transactions(loan.id)) as Array<Txn & { id: string }>;
      await send("PATCH", `${s.base}/transactions/${start?.id}`, s.cookie, { date: "2026-09-01" });
      await s.pay("2026-09-15", "90000", "", loan.id);
      await s.pay("2026-10-05", "90000", "", loan.id);
      const res = await send("POST", `${s.base}/accounts/${loan.id}/reconcile/preview`, s.cookie, {
        balance: "-9940000",
        date: TODAY,
        loanTerms: { interestRate: { rate: "7", keepGoingForward: true } },
      });
      // Only October is re-estimated: September stays at 6% ($500.00).
      expect(await res.json()).toEqual({ adjustment: "18188" });
    });

    it("re-estimates escrow the same way", async () => {
      const { loan, preview, reconcile, months, accountOn } = await x126();
      const escrow = { escrowAmount: { amount: "20000", keepGoingForward: true } };
      expect(await preview(escrow)).toBe("14875");
      const after = await reconcile(escrow);
      // Balance Adjustment +$148.75, escrow kept "Reconciled −$150.00", ended −$99,350.00.
      expect(after.balances.working).toBe("-9935000");
      expect(after.escrowAmount).toBe("20000");
      expect((await months(loan.id))[1]?.escrow).toMatchObject({
        applied: "15000",
        status: "reconciled",
      });
      expect((await accountOn("2026-12-01"))?.escrowAmount).toBe("20000");
    });

    it("refuses escrow on loans that aren't mortgages and terms on other accounts", async () => {
      const { base, cookie, addAccount, checking } = await x126();
      const car = await addAccount({ name: "Car", type: "auto_loan", balance: "-500000" });
      const escrow = { escrowAmount: { amount: "100", keepGoingForward: true } };
      const rate = { interestRate: { rate: "5", keepGoingForward: true } };
      for (const [id, loanTerms] of [
        [car.id, escrow],
        [checking.id, rate],
      ] as const) {
        const res = await send("POST", `${base}/accounts/${id}/reconcile`, cookie, {
          balance: "0",
          date: TODAY,
          loanTerms,
        });
        expect(res.status).toBe(400);
      }
    });
  });

  it("pairs one loan per category", async () => {
    const {
      base,
      cookie,
      addAccount,
      groups,
      payCategory,
      mortgage,
      account,
      checking,
      pay,
      transactions,
    } = await setup();
    const neg = await addAccount({
      name: "L7 Neg",
      type: "personal_loan",
      balance: "-1000100",
      interestRate: "6",
      pairedCategoryId: payCategory.id,
    });
    // Pairing moves the category.
    expect(neg.pairedCategoryId).toBe(payCategory.id);
    expect((await account(mortgage.id))?.pairedCategoryId).toBeNull();

    // An unpaired loan's payments are Uncategorized.
    await pay("2026-09-05", "1000", "x-unpaired");
    expect(
      (await transactions(checking.id)).find((t) => t.memo === "x-unpaired")?.categoryName,
    ).toBe("Uncategorized");

    await addAccount({ name: "Visa", type: "credit_card", balance: "0" });
    const payment = (await groups()).find((g) => g.kind === "credit_card_payments")?.categories[0];
    expect(payment).toBeDefined();
    const patch = (id: string, body: Record<string, unknown>) =>
      send("PATCH", `${base}/accounts/${id}`, cookie, { date: TODAY, ...body });
    expect((await patch(neg.id, { pairedCategoryId: null })).status).toBe(200);
    expect((await account(neg.id))?.pairedCategoryId).toBeNull();
    expect((await patch(checking.id, { pairedCategoryId: payCategory.id })).status).toBe(400);
    expect((await patch(neg.id, { pairedCategoryId: payment?.id })).status).toBe(400);

    // Closing a loan unpairs it.
    await patch(neg.id, { pairedCategoryId: payCategory.id });
    await send("POST", `${base}/accounts/${neg.id}/close`, cookie, { date: TODAY });
    expect((await account(neg.id))?.pairedCategoryId).toBeNull();
  });

  it("caps the charges at the month's payments", async () => {
    const { addAccount, pay, months } = await setup();
    const neg = await addAccount({
      name: "L7 Neg",
      type: "personal_loan",
      balance: "-1000100",
      interestRate: "6",
      minimumPayment: "2000",
      date: "2026-08-01",
    });
    await pay("2026-09-05", "2000", "", neg.id);
    expect((await months(neg.id))[1]).toMatchObject({
      interest: { total: "5001", applied: "2000" },
      endBalance: "-1000100",
    });
    await pay("2026-09-20", "10000", "", neg.id);
    expect((await months(neg.id))[1]?.endBalance).toBe("-993101");
  });

  it("refuses payments from off-budget accounts and to non-loans", async () => {
    const { base, cookie, addAccount, mortgage, checking } = await setup();
    const house = await addAccount({ name: "House", type: "asset", balance: "100" });
    const record = (loanId: string, fromAccountId: string, amount = "100") =>
      send("POST", `${base}/accounts/${loanId}/loan/payments`, cookie, {
        fromAccountId,
        amount,
        date: TODAY,
      });
    expect((await record(mortgage.id, house.id)).status).toBe(400);
    expect((await record(checking.id, checking.id)).status).toBe(400);
    expect((await record(mortgage.id, checking.id, "0")).status).toBe(400);
    expect((await send("GET", `${base}/accounts/${checking.id}/loan`, cookie)).status).toBe(400);
  });
});

describe("loan page banners", () => {
  it("dismisses the simulator banner plan-wide and the paid-off one per loan", async () => {
    const { cookie, base, addAccount, checking, mortgage } = await setup();
    const other = await addAccount({
      name: "x-142 Loan",
      type: "personal_loan",
      balance: "-10000",
      interestRate: "0",
      minimumPayment: "5000",
    });
    const banners = async (loanId: string) => {
      const res = await send("GET", `${base}/accounts/${loanId}/loan?today=${TODAY}`, cookie);
      return ((await res.json()) as { banners: unknown }).banners;
    };
    const dismiss = (loanId: string, banner: string) =>
      send("POST", `${base}/accounts/${loanId}/loan/banners/dismiss`, cookie, { banner });
    expect(await banners(mortgage.id)).toEqual({
      simulatorDismissed: false,
      paidOffDismissed: false,
    });

    const res = await dismiss(mortgage.id, "simulator");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ simulatorDismissed: true, paidOffDismissed: false });
    // One dismissal covers every loan.
    expect(await banners(other.id)).toEqual({ simulatorDismissed: true, paidOffDismissed: false });

    expect((await dismiss(other.id, "paidOff")).status).toBe(200);
    expect(await banners(other.id)).toEqual({ simulatorDismissed: true, paidOffDismissed: true });
    expect(await banners(mortgage.id)).toEqual({
      simulatorDismissed: true,
      paidOffDismissed: false,
    });

    // Outsiders, other account types and unknown banners are refused.
    const outsider = await signUp(app);
    expect(
      (
        await send("POST", `${base}/accounts/${other.id}/loan/banners/dismiss`, outsider.cookie, {
          banner: "paidOff",
        })
      ).status,
    ).toBe(404);
    expect((await dismiss(checking.id, "paidOff")).status).toBe(400);
    expect((await dismiss(other.id, "confetti")).status).toBe(400);
  });
});
