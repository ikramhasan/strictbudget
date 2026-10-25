import {
  accountFamily,
  type BudgetMonth,
  type MonthRange,
  REPORT_COMPARISONS,
  type ReportComparison,
  type ReportPreset,
} from "@strictbudget/engine";
import { NativeSelect, NativeSelectOption } from "@strictbudget/ui/components/native-select";
import { useQuery } from "@tanstack/react-query";
import { Flag } from "lucide-react";
import { accountsQueryOptions } from "@/lib/accounts";
import { useBudget } from "@/lib/budget-context";
import { categoriesQueryOptions } from "@/lib/categories";
import { COLOR_LABEL, FLAG_CLASS, flagsQueryOptions } from "@/lib/flags";
import { COMPARISON_LABELS, type ReportSearch, splitIds } from "@/lib/reports";
import { payeesQueryOptions } from "@/lib/transactions";
import { ChecklistFilter, type ChecklistSection } from "./checklist-filter";
import { type RangeChange, RangePicker } from "./range-picker";

export type ReportFilterName = "categories" | "accounts" | "payees" | "flags" | "compare";

export type UpdateSearch = (patch: Partial<ReportSearch>) => void;

const ACCOUNT_SECTIONS = [
  ["cash", "Cash Accounts"],
  ["credit", "Credit Accounts"],
  ["loan", "Loans"],
  ["tracking", "Tracking Accounts"],
] as const;

/** A report's filters, kept in its URL. */
export function ReportFilterBar({
  search,
  update,
  range,
  preset,
  current,
  earliest,
  show,
  accountFilter,
}: {
  search: ReportSearch;
  update: UpdateSearch;
  range: MonthRange;
  preset: ReportPreset | undefined;
  current: BudgetMonth;
  earliest: BudgetMonth | null;
  show: readonly ReportFilterName[];
  /** Which accounts the account filter offers (budget accounts for spending reports). */
  accountFilter?: (account: { type: Parameters<typeof accountFamily>[0] }) => boolean;
}) {
  const { budget } = useBudget();
  const categories = useQuery({
    ...categoriesQueryOptions(budget.id),
    enabled: show.includes("categories"),
  });
  const accounts = useQuery({
    ...accountsQueryOptions(budget.id),
    enabled: show.includes("accounts"),
  });
  const payees = useQuery({ ...payeesQueryOptions(budget.id), enabled: show.includes("payees") });
  const flags = useQuery({ ...flagsQueryOptions(budget.id), enabled: show.includes("flags") });

  const onRange = (change: RangeChange) =>
    update(
      "range" in change
        ? { range: change.range, from: undefined, to: undefined }
        : { range: undefined, from: change.from, to: change.to },
    );
  const ids = (list: string[] | undefined) => list?.join(",");

  const categorySections: ChecklistSection[] = categories.data
    ? [
        {
          id: "uncategorized",
          items: [
            { id: categories.data.uncategorizedCategoryId, label: "Uncategorized Transactions" },
          ],
        },
        ...categories.data.groups
          // Payment categories have no spending of their own.
          .filter((g) => !g.kind)
          .map((g) => ({
            id: g.id,
            title: g.name,
            items: g.categories.map((c) => ({
              id: c.id,
              label: c.name,
              hidden: c.hidden || g.hidden,
            })),
          })),
      ]
    : [];
  const shownAccounts = (accounts.data?.accounts ?? []).filter(
    (a) => !accountFilter || accountFilter(a),
  );
  const accountSections: ChecklistSection[] = [
    ...ACCOUNT_SECTIONS.map(([family, title]) => ({
      id: family,
      title,
      items: shownAccounts
        .filter((a) => !a.closed && accountFamily(a.type) === family)
        .map((a) => ({ id: a.id, label: a.name })),
    })),
    {
      id: "closed",
      title: "Closed Accounts",
      items: shownAccounts.filter((a) => a.closed).map((a) => ({ id: a.id, label: a.name })),
    },
  ].filter((s) => s.items.length);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <RangePicker
        range={range}
        preset={preset}
        current={current}
        earliest={earliest}
        onChange={onRange}
      />
      {show.includes("categories") && (
        <ChecklistFilter
          allLabel="All Categories"
          noun={["Category", "Categories"]}
          searchPlaceholder="Search All Categories"
          sections={categorySections}
          selected={splitIds(search.categories)}
          onChange={(v) => update({ categories: ids(v) })}
        />
      )}
      {show.includes("accounts") && (
        <ChecklistFilter
          allLabel="All Accounts"
          noun={["Account", "Accounts"]}
          searchPlaceholder="Search All Accounts"
          sections={accountSections}
          selected={splitIds(search.accounts)}
          onChange={(v) => update({ accounts: ids(v) })}
        />
      )}
      {show.includes("payees") && (
        <ChecklistFilter
          allLabel="All Payees"
          noun={["Payee", "Payees"]}
          searchPlaceholder="Search All Payees"
          sections={[
            {
              id: "payees",
              items: [
                { id: "none", label: "No payee" },
                ...(payees.data?.payees ?? []).map((p) => ({ id: p.id, label: p.name })),
              ],
            },
          ]}
          selected={splitIds(search.payees)}
          onChange={(v) => update({ payees: ids(v) })}
        />
      )}
      {show.includes("flags") && (
        <ChecklistFilter
          allLabel="All Flags"
          noun={["Flag", "Flags"]}
          searchPlaceholder="Search Flags"
          sections={[
            {
              id: "flags",
              items: [
                { id: "none", label: "No flag" },
                ...(flags.data?.flags ?? []).map((f) => ({
                  id: f.color,
                  label: f.name || COLOR_LABEL[f.color],
                  icon: <Flag className={`size-3.5 fill-current ${FLAG_CLASS[f.color]}`} />,
                })),
              ],
            },
          ]}
          selected={splitIds(search.flags)}
          onChange={(v) => update({ flags: ids(v) })}
        />
      )}
      {show.includes("compare") && (
        <NativeSelect
          aria-label="Compare with"
          // As wide as the chosen option, like the filter buttons beside it, not the longest one.
          style={{ fieldSizing: "content" }}
          value={search.compare ?? ""}
          onChange={(e) =>
            update({ compare: (e.target.value || undefined) as ReportComparison | undefined })
          }
        >
          <NativeSelectOption value="">No comparison</NativeSelectOption>
          {REPORT_COMPARISONS.map((c) => (
            <NativeSelectOption key={c} value={c}>
              Compare: {COMPARISON_LABELS[c]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      )}
    </div>
  );
}
