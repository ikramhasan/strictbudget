import {
  type AccountType,
  accountFamily,
  type CurrencyCode,
  hasPaymentCategory,
  SCHEDULE_FREQUENCIES,
  type ScheduleFrequency,
} from "@strictbudget/engine";
import { BACKUP_FORMAT, BACKUP_VERSION, type Backup } from "../backup/schema";
import {
  categoryFor,
  currencyOf,
  dateFormatOf,
  EXTERNAL_ACCOUNT_TYPES,
  EXTERNAL_CARD_GROUP,
  EXTERNAL_HIDDEN_GROUP,
  EXTERNAL_INTERNAL_GROUP,
  EXTERNAL_INTERNAL_PAYEES,
  EXTERNAL_READY_TO_ASSIGN,
  EXTERNAL_UNCATEGORIZED,
  minorUnits,
  numberFormatOf,
  symbolPositionOf,
} from "./convert";
import type { ExternalCategory, ExternalPlan } from "./types";

export interface Conversion {
  backup: Backup;
  /** What couldn't come over as it was, for the import report. */
  warnings: string[];
}

type Target = Backup["targets"][number];

const RTA_ID = "external:ready-to-assign";
const UNCATEGORIZED_ID = "external:uncategorized";
const INTERNAL_GROUP_ID = "external:internal";
const CARD_GROUP_ID = "external:card-payments";

const firstOf = (day: string) => `${day.slice(0, 7)}-01`;
const flagOf = (flag: string | null | undefined) =>
  flag ? (flag as Backup["transactions"][number]["flag"]) : null;

/** "7000" (the source's loan rate, thousandths of a percent) as "7.000". */
const percent = (value: number) =>
  `${Math.trunc(value / 1000)}.${String(Math.abs(value) % 1000).padStart(3, "0")}`;

/**
 * A source category goal as a target, following the source's API docs for the NEED fields
 * (goal_cadence, goal_cadence_frequency, goal_day, goal_needs_whole_amount) and its observed
 * behaviour for the legacy types (TB, TBD, MF) and payment-category targets. Returns a reason
 * instead when the goal can't be carried.
 */
function targetOf(
  c: ExternalCategory,
  input: {
    categoryId: string;
    payment: boolean;
    currency: CurrencyCode;
    firstMonth: string;
  },
): Target | string | null {
  const type = c.goal_type;
  if (!type) return null;
  const amount = minorUnits(c.goal_target ?? 0, input.currency);
  const date = c.goal_target_date ?? c.goal_target_month ?? null;
  const startMonth = c.goal_creation_month ? firstOf(c.goal_creation_month) : input.firstMonth;
  const base = {
    categoryId: input.categoryId,
    currency: input.currency,
    amount: amount.toString(),
    dueDay: null,
    dueDate: null,
    repeatEvery: null,
    repeatUnit: null,
    startMonth,
    startDay: null,
    snoozedMonth: c.goal_snoozed_at ? firstOf(c.goal_snoozed_at) : null,
  } satisfies Omit<Target, "cadence" | "behavior">;

  if (input.payment) {
    // Pay Specific Amount Monthly (MF) and Pay Off Balance by Date (TBD, goal_target 0).
    if (type === "MF" && amount > 0n) {
      return { ...base, cadence: "payment_monthly", behavior: "set_aside" };
    }
    if (type === "TBD" && date) {
      return {
        ...base,
        amount: "0",
        cadence: "payoff_by_date",
        behavior: "balance",
        dueDate: firstOf(date),
      };
    }
    return `the credit card payment target on "${c.name}" (${type})`;
  }
  // A $0 goal is the source's starter placeholder: it shows no target.
  if (amount <= 0n) return null;
  if (type === "TB") return { ...base, cadence: "custom", behavior: "balance" };
  if (type === "TBD") {
    if (!date) return `the target on "${c.name}" (a balance by a date, with no date)`;
    return { ...base, cadence: "custom", behavior: "balance", dueDate: firstOf(date) };
  }
  if (type === "MF") return { ...base, cadence: "monthly", behavior: "set_aside" };
  if (type === "DEBT") {
    return `the Monthly Debt Payment target on "${c.name}" (YNAB's API doesn't say which loan the category is paired with)`;
  }
  if (type !== "NEED") return `the target on "${c.name}" (type ${type})`;

  const behavior = c.goal_needs_whole_amount === false ? "refill" : "set_aside";
  const cadence = c.goal_cadence ?? 0;
  const frequency = c.goal_cadence_frequency ?? 1;
  // Cadences 0, 1, 2 and 13 repeat every cadence × frequency; 3–12 every 2–11 months; 14 every 2 years.
  const months =
    cadence === 1
      ? frequency
      : cadence >= 3 && cadence <= 12
        ? cadence - 1
        : cadence === 13
          ? 12 * frequency
          : cadence === 14
            ? 24
            : null;
  if (cadence === 2) {
    if (frequency !== 1) return `the target on "${c.name}" (every ${frequency} weeks)`;
    return { ...base, cadence: "weekly", behavior, dueDay: c.goal_day ?? null };
  }
  if (cadence === 0) {
    if (!date) return `the target on "${c.name}" (no due date)`;
    return { ...base, cadence: "custom", behavior, dueDate: date };
  }
  if (months === 1) return { ...base, cadence: "monthly", behavior, dueDay: c.goal_day ?? null };
  if (months === null || !date) return `the target on "${c.name}" (cadence ${cadence})`;
  if (months === 12) return { ...base, cadence: "yearly", behavior, dueDate: date };
  return {
    ...base,
    cadence: "custom",
    behavior,
    dueDate: date,
    repeatEvery: months % 12 === 0 ? months / 12 : months,
    repeatUnit: months % 12 === 0 ? "year" : "month",
  };
}

/**
 * A plan, as read from the source's API, in the backup layout, ready for `importBackup`:
 * accounts (with loan terms), payees, category groups and categories (with notes and targets),
 * every month's assigned amounts and notes, transactions (transfers, splits, flags, cleared and
 * approved states) and scheduled transactions. Deleted rows stay behind. Money is converted from
 * milliunits exactly.
 */
export function fromExternalApi(plan: ExternalPlan, now = new Date()): Conversion {
  const warnings: string[] = [];
  const format = plan.currency_format;
  const currency = currencyOf(format?.iso_code);
  const money = (milli: number) => minorUnits(milli, currency).toString();
  const numberFormat = (format && numberFormatOf(format)) ?? "comma_dot";
  if (format && !numberFormatOf(format)) {
    warnings.push(
      `YNAB's number format (decimal "${format.decimal_separator}", grouping "${format.group_separator}") isn't one strictbudget has; the budget uses 1,234.56.`,
    );
  }
  const dateFormat = dateFormatOf(plan.date_format?.format) ?? "MM/DD/YYYY";
  if (!dateFormatOf(plan.date_format?.format)) {
    warnings.push(
      `YNAB's date format ${plan.date_format?.format} isn't one strictbudget has; the budget uses MM/DD/YYYY.`,
    );
  }
  const firstMonth = firstOf(plan.first_month ?? now.toISOString());

  const accounts = plan.accounts.filter((a) => !a.deleted);
  const typeOf = new Map<string, AccountType>();
  const backupAccounts: Backup["accounts"] = [];
  const loanTerms: Backup["loanTerms"] = [];
  for (const [i, a] of accounts.entries()) {
    const type = EXTERNAL_ACCOUNT_TYPES[a.type];
    if (!type) {
      warnings.push(`The account "${a.name}" has a type strictbudget doesn't know (${a.type}).`);
      continue;
    }
    typeOf.set(a.id, type);
    const rates = a.debt_interest_rates ?? {};
    const minimums = a.debt_minimum_payments ?? {};
    const escrows = a.debt_escrow_amounts ?? {};
    const months = [
      ...new Set([...Object.keys(rates), ...Object.keys(minimums), ...Object.keys(escrows)]),
    ]
      .map(firstOf)
      .sort();
    // A month without its own value keeps the one before.
    let rate: string | null = null;
    let minimum: string | null = null;
    let escrow: string | null = null;
    for (const month of months) {
      const r = rates[month];
      const m = minimums[month];
      const e = escrows[month];
      if (r !== undefined) rate = percent(r);
      if (m !== undefined) minimum = money(m);
      if (e !== undefined) escrow = money(e);
      loanTerms.push({
        id: `${a.id}:${month}`,
        accountId: a.id,
        month,
        interestRate: rate,
        minimumPayment: minimum,
        escrowAmount: escrow,
        currency,
      });
    }
    backupAccounts.push({
      id: a.id,
      name: a.name,
      type,
      note: a.note ?? "",
      sortOrder: i,
      closed: a.closed,
      starredSortOrder: null,
      currency,
      interestRate: rate,
      minimumPayment: minimum,
      escrowAmount: escrow,
      lastReconciledAt: a.last_reconciled_at ?? null,
      pairedCategoryId: null,
      paidOffBannerDismissed: false,
      migratedToAccountId: null,
    });
  }
  const accountIds = new Set(backupAccounts.map((a) => a.id));
  if (backupAccounts.some((a) => accountFamily(a.type) === "loan")) {
    warnings.push(
      "Loan accounts come over unpaired: YNAB's API doesn't say which plan category each loan is paired with. Pair them again in the loan's page.",
    );
  }

  // Which rows refer to which categories (deleted ones that are still used come over hidden).
  const used = new Set<string>();
  for (const t of plan.transactions) if (!t.deleted && t.category_id) used.add(t.category_id);
  for (const s of plan.subtransactions) if (!s.deleted && s.category_id) used.add(s.category_id);
  for (const s of plan.scheduled_transactions)
    if (!s.deleted && s.category_id) used.add(s.category_id);
  for (const s of plan.scheduled_subtransactions)
    if (!s.deleted && s.category_id) used.add(s.category_id);
  for (const m of plan.months) for (const c of m.categories) if (c.budgeted !== 0) used.add(c.id);

  const groupName = new Map(plan.category_groups.map((g) => [g.id, g]));
  const categoryIds = new Map<string, string>();
  const groups: Backup["categoryGroups"] = [
    {
      id: INTERNAL_GROUP_ID,
      name: "Internal",
      sortOrder: 0,
      hidden: false,
      internal: true,
      kind: null,
    },
  ];
  const categories: Backup["categories"] = [
    {
      id: RTA_ID,
      groupId: INTERNAL_GROUP_ID,
      name: EXTERNAL_READY_TO_ASSIGN,
      note: "",
      sortOrder: 0,
      hidden: false,
      internalKind: "ready_to_assign",
      linkedAccountId: null,
    },
    {
      id: UNCATEGORIZED_ID,
      groupId: INTERNAL_GROUP_ID,
      name: EXTERNAL_UNCATEGORIZED,
      note: "",
      sortOrder: 1,
      hidden: false,
      internalKind: "uncategorized",
      linkedAccountId: null,
    },
  ];
  const creditByName = new Map(
    backupAccounts.filter((a) => hasPaymentCategory(a.type)).map((a) => [a.name, a.id]),
  );
  const linked = new Set<string>();
  const live = plan.categories.filter((c) => !c.deleted || used.has(c.id));
  const groupsInUse = new Set(live.map((c) => c.category_group_id));
  for (const [i, g] of plan.category_groups.entries()) {
    if (g.name === EXTERNAL_INTERNAL_GROUP) continue;
    if (g.deleted && !groupsInUse.has(g.id)) continue;
    // The source's own (empty) group for hidden categories: hidden ones stay in their groups.
    if (g.name === EXTERNAL_HIDDEN_GROUP && !groupsInUse.has(g.id)) continue;
    const card = g.name === EXTERNAL_CARD_GROUP;
    groups.push({
      id: card ? CARD_GROUP_ID : g.id,
      name: g.name,
      sortOrder: card ? -1 : i + 1,
      hidden: g.hidden || g.deleted,
      internal: false,
      kind: card ? "credit_card_payments" : null,
    });
  }
  const targets: Backup["targets"] = [];
  const order = new Map<string, number>();
  for (const c of live) {
    const group = groupName.get(c.category_group_id);
    if (group?.name === EXTERNAL_INTERNAL_GROUP) {
      if (c.name === EXTERNAL_READY_TO_ASSIGN) categoryIds.set(c.id, RTA_ID);
      else if (c.name === EXTERNAL_UNCATEGORIZED) categoryIds.set(c.id, UNCATEGORIZED_ID);
      else if (used.has(c.id)) {
        warnings.push(
          `YNAB's internal category "${c.name}" is used; its rows come over uncategorized.`,
        );
        categoryIds.set(c.id, UNCATEGORIZED_ID);
      }
      continue;
    }
    const card = group?.name === EXTERNAL_CARD_GROUP;
    const linkedAccountId = card ? (creditByName.get(c.name) ?? null) : null;
    if (card && !linkedAccountId) {
      warnings.push(`The credit card payment category "${c.name}" has no card of that name.`);
    }
    if (linkedAccountId) linked.add(linkedAccountId);
    if (c.deleted)
      warnings.push(`The deleted category "${c.name}" is still used; it comes over hidden.`);
    const groupId = card ? CARD_GROUP_ID : c.category_group_id;
    const sortOrder = order.get(groupId) ?? 0;
    order.set(groupId, sortOrder + 1);
    categoryIds.set(c.id, c.id);
    categories.push({
      id: c.id,
      groupId,
      name: c.name,
      note: c.note ?? "",
      sortOrder,
      hidden: c.hidden || c.deleted,
      internalKind: null,
      linkedAccountId,
    });
    const target = targetOf(c, {
      categoryId: c.id,
      payment: linkedAccountId !== null,
      currency,
      firstMonth,
    });
    if (typeof target === "string") warnings.push(`Not carried: ${target}.`);
    else if (target) targets.push(target);
  }
  // Every card needs its payment category; one the source lacks gets a fresh one.
  for (const a of backupAccounts) {
    if (!hasPaymentCategory(a.type) || linked.has(a.id)) continue;
    if (!groups.some((g) => g.id === CARD_GROUP_ID)) {
      groups.push({
        id: CARD_GROUP_ID,
        name: EXTERNAL_CARD_GROUP,
        sortOrder: -1,
        hidden: false,
        internal: false,
        kind: "credit_card_payments",
      });
    }
    const sortOrder = order.get(CARD_GROUP_ID) ?? 0;
    order.set(CARD_GROUP_ID, sortOrder + 1);
    categories.push({
      id: `external:payment:${a.id}`,
      groupId: CARD_GROUP_ID,
      name: a.name,
      note: "",
      sortOrder,
      hidden: false,
      internalKind: null,
      linkedAccountId: a.id,
    });
  }
  const category = (id: string | null) => (id ? (categoryIds.get(id) ?? null) : null);

  // Payees: the source treats names that differ only in case as one payee.
  const payeeIds = new Map<string, string>();
  const payees: Backup["payees"] = [];
  const byName = new Map<string, string>();
  const transferPayees = new Set<string>();
  for (const p of plan.payees) {
    if (p.transfer_account_id) {
      if (!accountIds.has(p.transfer_account_id) || transferPayees.has(p.transfer_account_id))
        continue;
      transferPayees.add(p.transfer_account_id);
      payeeIds.set(p.id, p.id);
      payees.push({
        id: p.id,
        name: p.name,
        internalKind: null,
        transferAccountId: p.transfer_account_id,
        hidden: false,
        categorization: "auto",
        defaultCategoryId: null,
        carriedCategoryId: null,
      });
      continue;
    }
    const key = p.name.toLowerCase();
    const existing = byName.get(key);
    if (existing) {
      payeeIds.set(p.id, existing);
      continue;
    }
    byName.set(key, p.id);
    payeeIds.set(p.id, p.id);
    payees.push({
      id: p.id,
      name: p.name || "(no name)",
      internalKind:
        EXTERNAL_INTERNAL_PAYEES[p.name as keyof typeof EXTERNAL_INTERNAL_PAYEES] ?? null,
      transferAccountId: null,
      hidden: p.deleted,
      categorization: "auto",
      defaultCategoryId: null,
      carriedCategoryId: null,
    });
  }
  const payee = (id: string | null) => (id ? (payeeIds.get(id) ?? null) : null);
  const startingBalanceIds = new Set(
    plan.payees
      .filter((p) => !p.transfer_account_id && p.name === "Starting Balance")
      .map((p) => p.id),
  );
  // Every account needs its transfer payee.
  for (const a of backupAccounts) {
    if (transferPayees.has(a.id)) continue;
    payees.push({
      id: `external:transfer:${a.id}`,
      name: `Transfer : ${a.name}`,
      internalKind: null,
      transferAccountId: a.id,
      hidden: false,
      categorization: "auto",
      defaultCategoryId: null,
      carriedCategoryId: null,
    });
  }

  const assignments: Backup["assignments"] = [];
  const monthNotes: Backup["monthNotes"] = [];
  for (const m of plan.months) {
    if (m.deleted) continue;
    if (m.note) monthNotes.push({ month: firstOf(m.month), note: m.note });
    for (const c of m.categories) {
      const id = category(c.id);
      if (!id || c.budgeted === 0) continue;
      assignments.push({
        categoryId: id,
        month: firstOf(m.month),
        amount: money(c.budgeted),
        currency,
      });
    }
  }

  // A loan's interest and escrow are charges here, not transactions.
  const loanCharges = new Map<string, Backup["loanCharges"][number]>();
  const transactions: Backup["transactions"] = [];
  const subTransactions: Backup["subTransactions"] = [];
  const kept = new Set<string>();
  const liveTransactions = plan.transactions.filter((t) => !t.deleted && typeOf.has(t.account_id));
  for (const t of liveTransactions) {
    const debtType = t.debt_transaction_type;
    if ((debtType === "interest" || debtType === "escrow") && !t.transfer_account_id) {
      const month = firstOf(t.date);
      const key = `${t.account_id}:${month}:${debtType}`;
      const prior = loanCharges.get(key);
      const amount = -minorUnits(t.amount, currency) + BigInt(prior?.amount ?? "0");
      loanCharges.set(key, {
        id: key,
        accountId: t.account_id,
        month,
        kind: debtType,
        amount: amount.toString(),
        currency,
        status: "edited",
      });
      continue;
    }
    kept.add(t.id);
  }
  const lines = plan.subtransactions.filter((s) => !s.deleted && kept.has(s.transaction_id));
  const splitParents = new Set(lines.map((s) => s.transaction_id));
  // A split's transfer line: the source's other side names no transaction; find it by account,
  // date and amount among the other account's transfers back that name none either.
  const transferLineOf = new Map<string, string>();
  const byId = new Map(liveTransactions.map((t) => [t.id, t]));
  for (const s of lines) {
    if (!s.transfer_account_id) continue;
    const parent = byId.get(s.transaction_id);
    const other = liveTransactions.find(
      (t) =>
        kept.has(t.id) &&
        !transferLineOf.has(t.id) &&
        t.account_id === s.transfer_account_id &&
        t.transfer_account_id === parent?.account_id &&
        t.transfer_transaction_id === null &&
        t.date === parent?.date &&
        t.amount === -s.amount,
    );
    if (other) transferLineOf.set(other.id, s.id);
    else
      warnings.push(
        `A split's transfer line on ${parent?.date} has no other side; it comes over unlinked.`,
      );
  }
  for (const t of liveTransactions) {
    if (!kept.has(t.id)) continue;
    const type = typeOf.get(t.account_id) as AccountType;
    const amount = minorUnits(t.amount, currency);
    const transferType = t.transfer_account_id ? (typeOf.get(t.transfer_account_id) ?? null) : null;
    const split = splitParents.has(t.id);
    const linkedTransaction =
      t.transfer_transaction_id && kept.has(t.transfer_transaction_id)
        ? t.transfer_transaction_id
        : null;
    transactions.push({
      id: t.id,
      accountId: t.account_id,
      date: t.date,
      amount: amount.toString(),
      currency,
      baseAmount: amount.toString(),
      fxRate: null,
      fxRateManual: false,
      payeeId: payee(t.payee_id),
      categoryId: split
        ? null
        : categoryFor({
            accountType: type,
            transferType,
            startingBalance: t.payee_id !== null && startingBalanceIds.has(t.payee_id),
            amount,
            categoryId: category(t.category_id),
            readyToAssignId: RTA_ID,
            uncategorizedId: UNCATEGORIZED_ID,
          }),
      memo: t.memo ?? "",
      cleared: t.cleared,
      flag: flagOf(t.flag_color),
      approved: t.approved,
      transferTransactionId: linkedTransaction,
      transferSubTransactionId: transferLineOf.get(t.id) ?? null,
    });
  }
  const lineOrder = new Map<string, number>();
  for (const s of lines) {
    const parent = byId.get(s.transaction_id);
    if (!parent) continue;
    const type = typeOf.get(parent.account_id) as AccountType;
    const amount = minorUnits(s.amount, currency);
    const sortOrder = lineOrder.get(s.transaction_id) ?? 0;
    lineOrder.set(s.transaction_id, sortOrder + 1);
    const transferType = s.transfer_account_id ? (typeOf.get(s.transfer_account_id) ?? null) : null;
    subTransactions.push({
      id: s.id,
      transactionId: s.transaction_id,
      sortOrder,
      amount: amount.toString(),
      currency,
      baseAmount: amount.toString(),
      payeeId: payee(s.payee_id),
      categoryId: categoryFor({
        accountType: type,
        transferType,
        startingBalance: false,
        amount,
        categoryId: category(s.category_id),
        readyToAssignId: RTA_ID,
        uncategorizedId: UNCATEGORIZED_ID,
      }),
      memo: s.memo ?? "",
    });
  }

  const scheduledTransactions: Backup["scheduledTransactions"] = [];
  const scheduledSubTransactions: Backup["scheduledSubTransactions"] = [];
  const schedules = plan.scheduled_transactions.filter(
    (s) => !s.deleted && typeOf.has(s.account_id),
  );
  const scheduledLines = plan.scheduled_subtransactions.filter((s) => !s.deleted);
  const scheduledSplits = new Set(scheduledLines.map((s) => s.scheduled_transaction_id));
  const scheduleIds = new Set<string>();
  for (const s of schedules) {
    if (!(SCHEDULE_FREQUENCIES as readonly string[]).includes(s.frequency)) {
      warnings.push(
        `A scheduled transaction repeats ${s.frequency}, which strictbudget doesn't have.`,
      );
      continue;
    }
    scheduleIds.add(s.id);
    const type = typeOf.get(s.account_id) as AccountType;
    const amount = minorUnits(s.amount, currency);
    const transferType = s.transfer_account_id ? (typeOf.get(s.transfer_account_id) ?? null) : null;
    scheduledTransactions.push({
      id: s.id,
      accountId: s.account_id,
      frequency: s.frequency as ScheduleFrequency,
      dateFirst: s.date_first,
      dateNext: s.date_next,
      amount: amount.toString(),
      currency,
      payeeId: payee(s.payee_id),
      categoryId: scheduledSplits.has(s.id)
        ? null
        : categoryFor({
            accountType: type,
            transferType,
            startingBalance: false,
            amount,
            categoryId: category(s.category_id),
            readyToAssignId: RTA_ID,
            uncategorizedId: UNCATEGORIZED_ID,
          }),
      memo: s.memo ?? "",
      flag: flagOf(s.flag_color),
    });
  }
  const scheduledOrder = new Map<string, number>();
  for (const s of scheduledLines) {
    if (!scheduleIds.has(s.scheduled_transaction_id)) continue;
    const parent = schedules.find((p) => p.id === s.scheduled_transaction_id);
    const type = typeOf.get(parent?.account_id ?? "") as AccountType;
    const amount = minorUnits(s.amount, currency);
    const sortOrder = scheduledOrder.get(s.scheduled_transaction_id) ?? 0;
    scheduledOrder.set(s.scheduled_transaction_id, sortOrder + 1);
    const transferType = s.transfer_account_id ? (typeOf.get(s.transfer_account_id) ?? null) : null;
    scheduledSubTransactions.push({
      scheduledTransactionId: s.scheduled_transaction_id,
      sortOrder,
      amount: amount.toString(),
      currency,
      payeeId: payee(s.payee_id),
      categoryId: categoryFor({
        accountType: type,
        transferType,
        startingBalance: false,
        amount,
        categoryId: category(s.category_id),
        readyToAssignId: RTA_ID,
        uncategorizedId: UNCATEGORIZED_ID,
      }),
      memo: s.memo ?? "",
    });
  }

  return {
    backup: {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: now.toISOString(),
      budget: {
        name: plan.name,
        currency,
        numberFormat,
        currencySymbolPosition: format ? symbolPositionOf(format) : "before",
        dateFormat,
        // The budget screen counts its first day from here.
        createdAt: `${firstMonth}T00:00:00.000Z`,
        expectedIncome: null,
        expectedIncomeCurrency: null,
        loanSimulatorBannerDismissed: false,
        aiEnabled: false,
        aiAssistantButton: false,
        viewOrder: null,
      },
      categoryGroups: groups,
      categories,
      accounts: backupAccounts,
      loanTerms,
      loanCharges: [...loanCharges.values()],
      payees,
      payeeRules: [],
      flagNames: [],
      assignments,
      moneyMoves: [],
      targets,
      monthNotes,
      views: [],
      transactions,
      subTransactions,
      scheduledTransactions,
      scheduledSubTransactions,
      fxRateOverrides: [],
      accountImportIds: [],
    },
    warnings,
  };
}
