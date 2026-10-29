import { addMonths, type BudgetMonth, formatAmount, money } from "@strictbudget/engine";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
  defaultFilter,
} from "@strictbudget/ui/components/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@strictbudget/ui/components/dialog";
import { type Theme, useTheme } from "@strictbudget/ui/lib/theme";
import { cn } from "@strictbudget/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { format, parse } from "date-fns";
import {
  Activity,
  CalendarDays,
  ChartColumn,
  Landmark,
  LayoutGrid,
  LogOut,
  type LucideIcon,
  Monitor,
  Moon,
  Plus,
  Search,
  Settings,
  Sparkles,
  Sun,
  Tag,
  UserCog,
  Wallet,
  Zap,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { accountsQueryOptions } from "@/lib/accounts";
import type { Budget } from "@/lib/budgets";
import { categoriesQueryOptions } from "@/lib/categories";
import { useScreenCommands } from "@/lib/commands";
import { inCurrency } from "@/lib/money-input";
import { currentMonth, lastViewedMonth, monthQueryOptions } from "@/lib/months";
import { settingsSectionId, visibleSettings } from "@/lib/settings-index";
import { capLabel, type KeyCap } from "@/lib/shortcuts";
import { AddAccountDialog } from "./add-account-dialog";

export interface PaletteItem {
  /** Unique across the palette: cmdk's value for it. */
  id: string;
  label: string;
  /** Other words it's found by. */
  keywords?: readonly string[];
  icon?: LucideIcon;
  /** Muted text at the end of the row (a balance, a group's name). */
  hint?: string;
  caps?: readonly KeyCap[];
  /** Ticked, as the theme in use is. */
  checked?: boolean;
  /** Listed only once something is typed: too many to show otherwise. */
  searchOnly?: boolean;
  /**
   * Runs once the palette has closed and focus is back where it was, as the key would from there
   * (a screen's actions, dialogs); the rest (going somewhere) run at once.
   */
  afterClose?: boolean;
  run: () => void;
}

export interface PaletteGroup {
  heading: string;
  items: readonly PaletteItem[];
  /** The most rows it shows for a search. */
  limit?: number;
}

/**
 * The groups a query leaves, best first: rows scored by cmdk's ranking on their label and keywords,
 * each group sorted and cut to its limit, and the groups ordered by their best row. Without a
 * query, every row that isn't search-only, in the groups' own order.
 */
export function filterGroups(groups: readonly PaletteGroup[], query: string) {
  const q = query.trim();
  if (!q) {
    return groups
      .map((group) => ({ ...group, items: group.items.filter((item) => !item.searchOnly) }))
      .filter((group) => group.items.length > 0);
  }
  return groups
    .map((group) => {
      const scored = group.items
        .map((item) => ({ item, score: defaultFilter(item.label, q, [...(item.keywords ?? [])]) }))
        .filter(({ score }) => score >= MIN_SCORE)
        .sort((a, b) => b.score - a.score);
      return {
        ...group,
        best: scored[0]?.score ?? 0,
        items: scored.slice(0, group.limit).map(({ item }) => item),
      };
    })
    .filter((group) => group.items.length > 0)
    .sort((a, b) => b.best - a.best);
}

/**
 * Below this a match is letters scattered across the words ("rent" in "Spending Trends"), which
 * only crowds the list; abbreviations ("chk" for Checking) score well above it.
 */
const MIN_SCORE = 0.05;

const REPORTS = [
  { to: "/budgets/$budgetId/reports", label: "Reports home" },
  { to: "/budgets/$budgetId/reports/spending-breakdown", label: "Spending Breakdown" },
  { to: "/budgets/$budgetId/reports/spending-trends", label: "Spending Trends" },
  { to: "/budgets/$budgetId/reports/spending-pace", label: "Spending Pace" },
  { to: "/budgets/$budgetId/reports/income-expense", label: "Income v Expense" },
  { to: "/budgets/$budgetId/reports/savings-rate", label: "Savings Rate" },
  { to: "/budgets/$budgetId/reports/budget-vs-actual", label: "Budget vs Actual" },
  { to: "/budgets/$budgetId/reports/net-worth", label: "Net Worth" },
  { to: "/budgets/$budgetId/reports/age-of-money", label: "Age of Money" },
  { to: "/budgets/$budgetId/reports/credit-card-health", label: "Credit Card Health" },
] as const;

const THEMES: readonly { value: Theme; label: string; icon: LucideIcon }[] = [
  { value: "light", label: "Light theme", icon: Sun },
  { value: "dark", label: "Dark theme", icon: Moon },
  { value: "system", label: "System theme", icon: Monitor },
];

/** How far back and ahead a typed month name reaches until the budget's own range is known. */
const MONTHS_BACK = 12;
const MONTHS_AHEAD = 12;

/**
 * The command palette (Cmd/Ctrl+K): go anywhere in the budget (pages,
 * accounts, categories, months, reports, settings, other budgets), run what the screen offers
 * with its keys shown, search transactions, ask the AI, and switch theme. A search ranks every
 * source together; Enter runs the best match, and Cmd/Ctrl+Enter asks the AI instead.
 */
export function CommandPalette({
  open,
  onOpenChange,
  budget,
  budgets,
  aiOn,
  onSignOut,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The budget showing, if any. */
  budget: Budget | undefined;
  budgets: readonly Budget[];
  aiOn: boolean;
  onSignOut: () => void;
}) {
  // An action waiting for the palette to close (see `afterClose`).
  const pending = useRef<(() => void) | null>(null);
  const [addingAccount, setAddingAccount] = useState(false);
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          // The Command is the whole surface, as the kit's CommandDialog has it.
          className="top-1/3 translate-y-0 overflow-hidden rounded-xl p-0 sm:max-w-xl"
          showCloseButton={false}
          onCloseAutoFocus={() => {
            const run = pending.current;
            pending.current = null;
            // Focus returns first (this runs just before), so the action starts from there.
            if (run) setTimeout(run, 0);
          }}
        >
          <DialogTitle className="sr-only">Command palette</DialogTitle>
          <DialogDescription className="sr-only">
            Go to a page, account, category or month, or run a command.
          </DialogDescription>
          <PaletteBody
            budget={budget}
            budgets={budgets}
            aiOn={aiOn}
            onSignOut={onSignOut}
            onAddAccount={() => setAddingAccount(true)}
            onClose={() => onOpenChange(false)}
            onRun={(item) => {
              if (item.afterClose) pending.current = item.run;
              onOpenChange(false);
              if (!item.afterClose) item.run();
            }}
          />
        </DialogContent>
      </Dialog>
      {budget && (
        <AddAccountDialog budget={budget} open={addingAccount} onOpenChange={setAddingAccount} />
      )}
    </>
  );
}

/** The palette's content, mounted while it's open: each opening starts with an empty search. */
function PaletteBody({
  budget,
  budgets,
  aiOn,
  onSignOut,
  onAddAccount,
  onRun,
  onClose,
}: {
  budget: Budget | undefined;
  budgets: readonly Budget[];
  aiOn: boolean;
  onSignOut: () => void;
  onAddAccount: () => void;
  onRun: (item: PaletteItem) => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const { accountId } = useParams({ strict: false });
  const { month: shownMonth } = useSearch({ strict: false });
  const screen = useScreenCommands();
  const budgetId = budget?.id;
  const accounts = useQuery({ ...accountsQueryOptions(budgetId ?? ""), enabled: !!budgetId });
  const categories = useQuery({ ...categoriesQueryOptions(budgetId ?? ""), enabled: !!budgetId });
  // The budget screen's current month (cached there): it holds the months the budget spans.
  const thisMonth = useQuery({
    ...monthQueryOptions(budgetId ?? "", currentMonth()),
    enabled: !!budgetId,
  });
  const [query, setQuery] = useState("");
  const q = query.trim();

  const groups = useMemo<PaletteGroup[]>(() => {
    const all: PaletteGroup[] = [];

    all.push({
      heading: "On this screen",
      items: screen
        .filter((c) => c.group === "screen")
        .map((c) => ({
          id: `screen:${c.key}`,
          label: c.label,
          icon: Zap,
          caps: c.caps,
          afterClose: true,
          run: c.run,
        })),
    });

    if (budget) {
      const budgetId = budget.id;
      const params = { budgetId };
      const editor = budget.role !== "viewer";
      all.push({
        heading: "Go to",
        items: [
          {
            id: "go:budget",
            label: "Budget",
            keywords: ["plan", "categories", "assign"],
            icon: Wallet,
            run: () =>
              void navigate({
                to: "/budgets/$budgetId",
                params,
                search: { month: lastViewedMonth(budgetId) },
              }),
          },
          {
            id: "go:reports",
            label: "Reports",
            keywords: ["reflect", "charts"],
            icon: ChartColumn,
            run: () => void navigate({ to: "/budgets/$budgetId/reports", params }),
          },
          {
            id: "go:accounts",
            label: "All Accounts",
            keywords: ["transactions", "register"],
            icon: Landmark,
            run: () => void navigate({ to: "/budgets/$budgetId/accounts", params }),
          },
          {
            id: "go:activity",
            label: "Activity",
            keywords: ["history", "changes", "log"],
            icon: Activity,
            run: () => void navigate({ to: "/budgets/$budgetId/activity", params }),
          },
          ...(aiOn
            ? [
                {
                  id: "go:ai",
                  label: "AI assistant",
                  keywords: ["chat"],
                  icon: Sparkles,
                  run: () => void navigate({ to: "/budgets/$budgetId/ai", params }),
                },
              ]
            : []),
          {
            id: "go:budget-settings",
            label: "Budget settings",
            keywords: ["preferences"],
            icon: Settings,
            run: () => void navigate({ to: "/budgets/$budgetId/settings", params }),
          },
          {
            id: "go:account-settings",
            label: "Account settings",
            keywords: ["profile", "preferences"],
            icon: UserCog,
            run: () => void navigate({ to: "/account" }),
          },
          {
            id: "go:budgets",
            label: "All budgets",
            icon: LayoutGrid,
            run: () => void navigate({ to: "/budgets" }),
          },
        ],
      });

      const list = accounts.data?.accounts ?? [];
      all.push({
        heading: "Accounts",
        limit: 8,
        items: list.map((account) => ({
          id: `account:${account.id}`,
          label: account.name,
          keywords: [account.note, account.closed ? "closed" : ""].filter(Boolean),
          icon: Landmark,
          hint: account.closed
            ? "Closed"
            : formatAmount(
                money(
                  BigInt(account.balances.working),
                  inCurrency(budget, account.currency).currency,
                ),
                budget,
              ),
          // Closed accounts are there to be found, not listed.
          searchOnly: account.closed,
          run: () =>
            void navigate({
              to: "/budgets/$budgetId/accounts/$accountId",
              params: { budgetId, accountId: account.id },
            }),
        })),
      });

      // Relative to the month the budget screen shows (or last showed).
      const base = (shownMonth as BudgetMonth | undefined) ?? lastViewedMonth(budgetId);
      const now = currentMonth();
      const from = base ?? now;
      const toMonth = (month: BudgetMonth) => () =>
        void navigate({
          to: "/budgets/$budgetId",
          params,
          search: { month: month === now ? undefined : month },
        });
      // The months the budget screen can show (it moves a month outside them to the nearest).
      const first =
        (thisMonth.data?.firstMonth as BudgetMonth | undefined) ?? addMonths(now, -MONTHS_BACK);
      const last =
        (thisMonth.data?.lastMonth as BudgetMonth | undefined) ?? addMonths(now, MONTHS_AHEAD);
      const inRange = (month: BudgetMonth) => month >= first && month <= last;
      const nearby = [
        { id: "month:now", label: "This month", month: now },
        { id: "month:previous", label: "Previous month", month: addMonths(from, -1) },
        { id: "month:next", label: "Next month", month: addMonths(from, 1) },
      ].filter(({ month }) => inRange(month));
      const named: BudgetMonth[] = [];
      for (let month = first; month <= last; month = addMonths(month, 1)) named.push(month);
      // Nearest to now first: "march" ranks every March alike, and the group keeps only a few.
      const away = (month: BudgetMonth) => Math.abs(monthNumber(month) - monthNumber(now));
      named.sort((a, b) => away(a) - away(b));
      all.push({
        heading: "Months",
        limit: 4,
        items: [
          ...nearby.map(({ id, label, month }) => ({
            id,
            label,
            keywords: ["month", "go to"],
            icon: CalendarDays,
            hint: monthTitle(month),
            run: toMonth(month),
          })),
          ...named.map((month) => ({
            id: `month:${month}`,
            label: monthTitle(month),
            keywords: [month, format(parse(month, "yyyy-MM", new Date()), "MMM yyyy")],
            icon: CalendarDays,
            searchOnly: true,
            run: toMonth(month),
          })),
        ],
      });

      all.push({
        heading: "Categories",
        limit: 8,
        items: (categories.data?.groups ?? [])
          .filter((group) => !group.hidden)
          .flatMap((group) =>
            group.categories
              .filter((category) => !category.hidden)
              .map((category) => ({
                id: `category:${category.id}`,
                label: category.name,
                keywords: [group.name],
                icon: Tag,
                hint: group.name,
                searchOnly: true,
                // The plan, on the month showing, with the category selected and in view.
                run: () =>
                  void navigate({
                    to: "/budgets/$budgetId",
                    params,
                    search: { month: base, category: category.id },
                  }),
              })),
          ),
      });

      all.push({
        heading: "Reports",
        limit: 5,
        items: REPORTS.map((report) => ({
          id: `report:${report.to}`,
          label: report.label,
          keywords: ["report"],
          icon: ChartColumn,
          searchOnly: true,
          run: () => void navigate({ to: report.to, params }),
        })),
      });

      if (editor) {
        all.push({
          heading: "Create",
          items: [
            {
              id: "create:account",
              label: "Add account",
              keywords: ["new account", "create"],
              icon: Plus,
              afterClose: true,
              run: onAddAccount,
            },
            {
              id: "create:budget",
              label: "New budget",
              keywords: ["create", "plan"],
              icon: Plus,
              run: () => void navigate({ to: "/budgets/new" }),
            },
          ],
        });
      }
    } else {
      all.push({
        heading: "Go to",
        items: [
          {
            id: "go:budgets",
            label: "All budgets",
            icon: LayoutGrid,
            run: () => void navigate({ to: "/budgets" }),
          },
          {
            id: "go:account-settings",
            label: "Account settings",
            keywords: ["profile", "preferences"],
            icon: UserCog,
            run: () => void navigate({ to: "/account" }),
          },
          {
            id: "create:budget",
            label: "New budget",
            keywords: ["create", "plan"],
            icon: Plus,
            run: () => void navigate({ to: "/budgets/new" }),
          },
        ],
      });
    }

    all.push({
      heading: "Budgets",
      limit: 5,
      items: budgets
        .filter((b) => b.id !== budgetId)
        .map((b) => ({
          id: `budget:${b.id}`,
          label: b.name,
          keywords: ["switch budget", "open budget", b.archivedAt ? "archived" : ""].filter(
            Boolean,
          ),
          icon: Wallet,
          hint: b.archivedAt ? "Archived" : undefined,
          searchOnly: Boolean(b.archivedAt),
          run: () => void navigate({ to: "/budgets/$budgetId", params: { budgetId: b.id } }),
        })),
    });

    all.push({
      heading: "Settings",
      limit: 6,
      items: visibleSettings(budget?.role ?? null).map((setting) => ({
        id: `setting:${setting.page}:${setting.tab}:${setting.title}`,
        label: setting.title,
        keywords: setting.keywords,
        icon: Settings,
        hint: setting.where,
        searchOnly: true,
        run:
          setting.page === "account"
            ? () =>
                void navigate({
                  to: "/account",
                  search: { tab: setting.tab },
                  hash: settingsSectionId(setting.section),
                  resetScroll: false,
                })
            : () =>
                void navigate({
                  to: "/budgets/$budgetId/settings",
                  params: { budgetId: budgetId ?? "" },
                  search: { tab: setting.tab },
                  hash: settingsSectionId(setting.section),
                  resetScroll: false,
                }),
      })),
    });

    all.push({
      heading: "Theme",
      items: THEMES.map(({ value, label, icon }) => ({
        id: `theme:${value}`,
        label,
        keywords: ["theme", "appearance", "mode"],
        icon,
        checked: theme === value,
        run: () => setTheme(value),
      })),
    });

    all.push({
      heading: "General",
      items: [
        ...screen
          .filter((c) => c.group === "general")
          .map((c) => ({
            id: `general:${c.key}`,
            label: c.label,
            caps: c.caps,
            icon: Zap,
            afterClose: true,
            run: c.run,
          })),
        {
          id: "general:sign-out",
          label: "Sign out",
          keywords: ["log out"],
          icon: LogOut,
          run: onSignOut,
        },
      ],
    });
    return all;
  }, [
    navigate,
    screen,
    budgetId,
    budget,
    aiOn,
    accounts.data,
    categories.data,
    thisMonth.data,
    shownMonth,
    budgets,
    theme,
    setTheme,
    onAddAccount,
    onSignOut,
  ]);

  // Pinned around the ranked results: the AI on top, a transaction search at the end.
  const askAi: PaletteItem | null =
    aiOn && budgetId
      ? {
          id: "ask-ai",
          label: q ? `Ask AI: ${q}` : "Ask AI",
          icon: Sparkles,
          caps: q ? ["mod", "↵"] : undefined,
          run: () =>
            void navigate({
              to: "/budgets/$budgetId/ai",
              params: { budgetId },
              search: q ? { ask: q } : {},
            }),
        }
      : null;
  const shownAccount = accountId
    ? accounts.data?.accounts.find((a) => a.id === accountId)
    : undefined;
  const searchTransactions: PaletteItem | null =
    budgetId && q
      ? {
          id: "search-transactions",
          label: shownAccount
            ? `Search ${shownAccount.name} for “${q}”`
            : `Search transactions for “${q}”`,
          icon: Search,
          run: () =>
            void navigate(
              shownAccount
                ? {
                    to: "/budgets/$budgetId/accounts/$accountId",
                    params: { budgetId, accountId: shownAccount.id },
                    search: { q },
                  }
                : { to: "/budgets/$budgetId/accounts", params: { budgetId }, search: { q } },
            ),
        }
      : null;

  const results = useMemo(() => filterGroups(groups, q), [groups, q]);

  return (
    <Command
      shouldFilter={false}
      loop
      onKeyDown={(event) => {
        if (!(event.metaKey || event.ctrlKey)) return;
        // Cmd/Ctrl+K again closes it, as it opened it.
        if (event.key.toLowerCase() === "k") {
          event.preventDefault();
          onClose();
        } else if (event.key === "Enter" && askAi && q) {
          event.preventDefault();
          onRun(askAi);
        }
      }}
    >
      <CommandInput
        onValueChange={setQuery}
        placeholder={aiOn && budgetId ? "Search or ask AI…" : "Search or jump to…"}
        aria-label="Search commands"
      />
      <CommandList
        // A column, so the AI's row can show first while coming last (see below).
        className="max-h-[min(24rem,50svh)] [&>[cmdk-list-sizer]]:flex [&>[cmdk-list-sizer]]:flex-col"
      >
        <CommandEmpty>Nothing matches.</CommandEmpty>
        {/* With nothing else matching, the AI is what Enter runs: first in the list as well. */}
        {askAi && results.length === 0 && (
          <CommandGroup>
            <Row item={askAi} onRun={onRun} />
          </CommandGroup>
        )}
        {results.map((group) => (
          <CommandGroup key={group.heading} heading={group.heading}>
            {group.items.map((item) => (
              <Row key={item.id} item={item} onRun={onRun} />
            ))}
          </CommandGroup>
        ))}
        {searchTransactions && (
          <CommandGroup heading="Transactions">
            <Row item={searchTransactions} onRun={onRun} />
          </CommandGroup>
        )}
        {/*
         * Shown on top but last in the list, so cmdk selects the best match first and Enter runs
         * it; with the list looping, the arrow keys still reach the AI's row right above it and
         * below the last row, where it shows.
         */}
        {askAi && results.length > 0 && (
          <CommandGroup className="order-first">
            <Row item={askAi} onRun={onRun} />
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  );
}

function Row({ item, onRun }: { item: PaletteItem; onRun: (item: PaletteItem) => void }) {
  const Icon = item.icon;
  return (
    <CommandItem
      value={item.id}
      onSelect={() => onRun(item)}
      data-checked={item.checked || undefined}
      // The kit's tick shows only on a row that can be ticked.
      className={cn(item.checked === undefined && "[&>svg:last-child]:hidden")}
    >
      {Icon && <Icon aria-hidden />}
      <span className="min-w-0 truncate">{item.label}</span>
      {item.hint && (
        <span className="ml-auto shrink-0 pl-2 text-muted-foreground text-xs tabular-nums">
          {item.hint}
        </span>
      )}
      {item.caps && (
        // A phone has no keys to show.
        <span className="ml-auto flex shrink-0 items-center gap-1 pl-2 max-sm:hidden">
          {item.caps.map((cap, i) =>
            cap === "then" ? (
              <span key={i} className="text-muted-foreground text-xs">
                then
              </span>
            ) : (
              <CommandShortcut key={i} className="ml-0">
                {capLabel(cap)}
              </CommandShortcut>
            ),
          )}
        </span>
      )}
    </CommandItem>
  );
}

/** Months since year 0, to compare how far apart two are. */
function monthNumber(month: BudgetMonth) {
  const [year, number] = month.split("-").map(Number);
  return (year ?? 0) * 12 + (number ?? 0);
}

/** "October 2026". */
function monthTitle(month: BudgetMonth) {
  return format(parse(month, "yyyy-MM", new Date()), "MMMM yyyy");
}
