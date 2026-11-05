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
  ArrowLeftRight,
  CalendarDays,
  ChartColumn,
  ChevronRight,
  Landmark,
  LayoutGrid,
  LogOut,
  type LucideIcon,
  Monitor,
  Moon,
  Plus,
  Receipt,
  Search,
  Settings,
  Sparkles,
  Sun,
  SunMoon,
  Tag,
  UserCog,
  Wallet,
  Zap,
} from "lucide-react";
import { type RefObject, useRef, useState } from "react";
import { accountsQueryOptions } from "@/lib/accounts";
import type { Budget } from "@/lib/budgets";
import { categoriesQueryOptions } from "@/lib/categories";
import { moveTarget, useCommandRegistry, useScreenCommands } from "@/lib/commands";
import { inCurrency } from "@/lib/money-input";
import { currentMonth, lastViewedMonth, monthQueryOptions } from "@/lib/months";
import { settingsSectionId, visibleSettings } from "@/lib/settings-index";
import { capLabel, type KeyCap, SHORTCUTS } from "@/lib/shortcuts";
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
  /** Opens a list of its own in the palette (accounts, categories, months) instead of closing. */
  opens?: PageId;
  run: () => void;
}

/** The palette's second steps: picking what a command acts on. */
type PageId = "add" | "move" | "month";

const PAGES: Record<PageId, { title: string; placeholder: string }> = {
  add: { title: "Add transaction", placeholder: "Add a transaction to which account?" },
  move: { title: "Move money", placeholder: "Move money from which category?" },
  month: { title: "Go to month", placeholder: "Type a month…" },
};

export interface PaletteGroup {
  heading: string;
  items: readonly PaletteItem[];
  /** The most rows it shows for a search. */
  limit?: number;
  /**
   * Names the user made up (accounts, categories): found by letters scattered across the words
   * too ("chk" for Checking). Commands, places and settings are found only by how a word starts.
   */
  loose?: boolean;
}

/**
 * The groups a query leaves, best first: rows ranked by how they match (`matchScore`), each group
 * sorted and cut to its limit, and the groups ordered by their best row. Without a query, every
 * row that isn't search-only, in the groups' own order.
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
        .map((item) => ({ item, score: matchScore(item, q, group.loose ?? false) }))
        .filter(({ score }) => score > 0)
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

/** Leading emoji and punctuation, which a name's first word comes after ("🛒 Groceries"). */
const LEADING = /^[^\p{L}\p{N}]+/u;

/** Whether a word of `text` (or a run of its words) starts with `query`. */
function startsAWord(text: string, query: string) {
  for (let at = text.indexOf(query); at !== -1; at = text.indexOf(query, at + 1)) {
    if (at === 0 || /[^\p{L}\p{N}]/u.test(text.charAt(at - 1))) return true;
  }
  return false;
}

/**
 * How well `query` finds an item, 0 for not at all: the label's start first, then the start of
 * one of its words, then of a keyword, with cmdk's score ordering rows within each. Letters
 * scattered across the words count only in a `loose` group, below every other match.
 */
export function matchScore(
  item: Pick<PaletteItem, "label" | "keywords">,
  query: string,
  loose: boolean,
) {
  const q = query.trim().toLowerCase();
  const label = item.label.toLowerCase();
  const keywords = (item.keywords ?? []).map((k) => k.toLowerCase());
  const score = defaultFilter(item.label, query, [...(item.keywords ?? [])]);
  if (label.replace(LEADING, "").startsWith(q)) return 3 + score;
  if (startsAWord(label, q)) return 2 + score;
  if (keywords.some((k) => startsAWord(k, q))) return 1 + score;
  return loose && score >= MIN_SCORE ? score : 0;
}

const REPORTS = [
  { to: "/budgets/$budgetId/reports", label: "Reports home" },
  { to: "/budgets/$budgetId/reports/spending-breakdown", label: "Spending Breakdown" },
  { to: "/budgets/$budgetId/reports/spending-trends", label: "Spending Trends" },
  { to: "/budgets/$budgetId/reports/spending-pace", label: "Spending Pace" },
  { to: "/budgets/$budgetId/reports/income-expense", label: "Income v Expense" },
  { to: "/budgets/$budgetId/reports/budget-vs-actual", label: "Budget vs Actual" },
  { to: "/budgets/$budgetId/reports/category-history", label: "Category History" },
  { to: "/budgets/$budgetId/reports/net-worth", label: "Net Worth" },
  { to: "/budgets/$budgetId/reports/age-of-money", label: "Age of Money" },
  { to: "/budgets/$budgetId/reports/credit-card-health", label: "Credit Card Health" },
  { to: "/budgets/$budgetId/reports/spending-by-flag", label: "Spending by Flag" },
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
  // Escape on a second step goes back to the first rather than closing.
  const back = useRef<(() => boolean) | null>(null);
  const [addingAccount, setAddingAccount] = useState(false);
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          // The Command is the whole surface, as the kit's CommandDialog has it.
          className="top-1/3 translate-y-0 overflow-hidden rounded-xl p-0 sm:max-w-xl"
          showCloseButton={false}
          onEscapeKeyDown={(event) => {
            if (back.current?.()) event.preventDefault();
          }}
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
            back={back}
            onRun={(item) => {
              if (item.opens) return item.run();
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
  back,
}: {
  budget: Budget | undefined;
  budgets: readonly Budget[];
  aiOn: boolean;
  onSignOut: () => void;
  onAddAccount: () => void;
  onRun: (item: PaletteItem) => void;
  onClose: () => void;
  /** Set to what Escape does first: going back from a second step (true) or nothing (false). */
  back: RefObject<(() => boolean) | null>;
}) {
  const navigate = useNavigate();
  const registry = useCommandRegistry();
  const { theme, resolvedTheme, setTheme } = useTheme();
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
  const [page, setPage] = useState<PageId | null>(null);
  const openPage = (next: PageId | null) => {
    setPage(next);
    setQuery("");
  };
  back.current = () => {
    if (!page) return false;
    openPage(null);
    return true;
  };
  const editor = budget !== undefined && budget.role !== "viewer";
  // The month the budget screen shows (or last showed): months and moves are relative to it.
  const now = currentMonth();
  const base =
    (shownMonth as BudgetMonth | undefined) ?? (budgetId ? lastViewedMonth(budgetId) : undefined);
  // Its figures (each category's Available) for Move money, cached once the plan has shown it.
  const baseMonth = useQuery({
    ...monthQueryOptions(budgetId ?? "", base ?? now),
    enabled: !!budgetId && page === "move",
  });
  // The months the budget screen can show (it moves a month outside them to the nearest).
  const first =
    (thisMonth.data?.firstMonth as BudgetMonth | undefined) ?? addMonths(now, -MONTHS_BACK);
  const last =
    (thisMonth.data?.lastMonth as BudgetMonth | undefined) ?? addMonths(now, MONTHS_AHEAD);
  const toMonth = (month: BudgetMonth) => () =>
    void navigate({
      to: "/budgets/$budgetId",
      params: { budgetId: budgetId ?? "" },
      search: { month: month === now ? undefined : month },
    });
  // A screen that adds transactions (a register) offers its own Add transaction.
  const addLabel = SHORTCUTS.addTransaction.command;
  const screenAdds = screen.some((c) => c.label === addLabel);

  const rootGroups = (): PaletteGroup[] => {
    const all: PaletteGroup[] = [];

    all.push({
      heading: "On this screen",
      items: screen
        .filter((c) => c.group === "screen")
        .map((c) => ({
          id: `screen:${c.key}`,
          label: c.label,
          keywords: c.keywords,
          icon: Zap,
          caps: c.caps,
          afterClose: true,
          run: c.run,
        })),
    });

    if (budget) {
      const budgetId = budget.id;
      const params = { budgetId };
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
            label: "All accounts",
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
        loose: true,
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

      const from = base ?? now;
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
        loose: true,
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
          {
            id: "month:pick",
            label: "Go to month…",
            keywords: ["month", "jump", "date", "calendar"],
            icon: CalendarDays,
            opens: "month" as const,
            run: () => openPage("month"),
          },
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
        loose: true,
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

      const openAccounts = list.filter((account) => !account.closed);
      if (editor) {
        all.push({
          heading: "Actions",
          items: [
            ...(screenAdds || openAccounts.length === 0
              ? []
              : [
                  {
                    id: "action:add-transaction",
                    label: "Add transaction…",
                    keywords: ["new transaction", "expense", "income", "record", "create"],
                    icon: Receipt,
                    opens: "add" as const,
                    run: () => openPage("add"),
                  },
                ]),
            {
              id: "action:move-money",
              label: "Move money…",
              keywords: ["transfer", "cover", "reallocate", "budget"],
              icon: ArrowLeftRight,
              opens: "move" as const,
              run: () => openPage("move"),
            },
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
      loose: true,
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

    const opposite = resolvedTheme === "dark" ? "light" : "dark";
    all.push({
      heading: "Theme",
      items: [
        {
          id: "theme:toggle",
          label: "Toggle theme",
          keywords: ["dark mode", "light mode", "appearance", `switch to ${opposite}`],
          icon: SunMoon,
          hint: `Switch to ${opposite}`,
          run: () => setTheme(opposite),
        },
        ...THEMES.map(({ value, label, icon }) => ({
          id: `theme:${value}`,
          label,
          keywords: ["theme", "appearance", "mode", `${value} mode`],
          icon,
          checked: theme === value,
          run: () => setTheme(value),
        })),
      ],
    });

    all.push({
      heading: "General",
      items: [
        ...screen
          .filter((c) => c.group === "general")
          .map((c) => ({
            id: `general:${c.key}`,
            label: c.label,
            keywords: c.keywords,
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
  };

  /** A second step's list: what the command it came from acts on. */
  const pageGroups = (id: PageId): PaletteGroup[] => {
    if (!budget || !budgetId) return [];
    const inBudget = (amount: string, currency?: string | null) =>
      formatAmount(money(BigInt(amount), inCurrency(budget, currency).currency), budget);
    if (id === "add") {
      return [
        {
          heading: "Accounts",
          loose: true,
          items: (accounts.data?.accounts ?? [])
            .filter((account) => !account.closed)
            .map((account) => ({
              id: `add:${account.id}`,
              label: account.name,
              keywords: [account.note].filter(Boolean),
              icon: Landmark,
              hint: inBudget(account.balances.working, account.currency),
              afterClose: true,
              // The register, then its add row once it offers one.
              run: () =>
                void navigate({
                  to: "/budgets/$budgetId/accounts/$accountId",
                  params: { budgetId, accountId: account.id },
                }).then(() => registry?.runWhenOffered(addLabel)),
            })),
        },
      ];
    }
    if (id === "move") {
      const available = new Map(
        (baseMonth.data?.categories ?? []).map((c) => [c.categoryId, c.available]),
      );
      return (categories.data?.groups ?? [])
        .filter((group) => !group.hidden)
        .map((group) => ({
          heading: group.name,
          loose: true,
          items: group.categories
            .filter((category) => !category.hidden)
            .map((category) => {
              const amount = available.get(category.id);
              return {
                id: `move:${category.id}`,
                label: category.name,
                keywords: [group.name],
                icon: Tag,
                hint: amount === undefined ? undefined : inBudget(amount),
                afterClose: true,
                // The plan with the category selected, then its Move popover.
                run: () =>
                  void navigate({
                    to: "/budgets/$budgetId",
                    params: { budgetId },
                    search: { month: base, category: category.id },
                  }).then(() => registry?.request(moveTarget(category.id))),
              };
            }),
        }));
    }
    const months: BudgetMonth[] = [];
    for (let month = first; month <= last; month = addMonths(month, 1)) months.push(month);
    const showing = base ?? now;
    return [
      {
        heading: "Months",
        loose: true,
        items: months.map((month) => ({
          id: `goto:${month}`,
          label: monthTitle(month),
          keywords: [month, format(parse(month, "yyyy-MM", new Date()), "MMM yyyy")],
          icon: CalendarDays,
          hint: month === now ? "This month" : month === showing ? "Showing" : undefined,
          run: toMonth(month),
        })),
      },
    ];
  };

  // Pinned around the ranked results: the AI on top, a transaction search at the end.
  const askAi: PaletteItem | null =
    !page && aiOn && budgetId
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
    !page && budgetId && q
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

  const results = filterGroups(page ? pageGroups(page) : rootGroups(), q);

  return (
    <Command
      // A fresh list for each step, so its selection starts at its own first row.
      key={page ?? "root"}
      defaultValue={page === "month" ? `goto:${base ?? now}` : undefined}
      shouldFilter={false}
      loop
      onKeyDown={(event) => {
        // Backspace in an empty search goes back a step, as Escape does.
        if (page && event.key === "Backspace" && query === "") {
          event.preventDefault();
          openPage(null);
          return;
        }
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
        value={query}
        onValueChange={setQuery}
        // Focus stays in the search as the list changes to a second step and back.
        autoFocus
        chip={page && PAGES[page].title}
        placeholder={
          page
            ? PAGES[page].placeholder
            : aiOn && budgetId
              ? "Search or ask AI…"
              : "Search or jump to…"
        }
        aria-label={page ? PAGES[page].placeholder : "Search commands"}
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
      {item.opens && (
        <ChevronRight
          aria-hidden
          className={cn(
            "size-3.5! text-muted-foreground group-data-[selected=true]/command-item:text-foreground",
            !item.hint && "ml-auto",
          )}
        />
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
