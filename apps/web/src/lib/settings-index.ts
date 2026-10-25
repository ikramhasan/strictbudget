/**
 * Every setting on the Account and Budget settings pages, by the tab it's on and the section that
 * holds it, so the settings search can find one by name (or a word for it) and go straight to it.
 */

export type BudgetRole = "owner" | "editor" | "viewer";

export const ACCOUNT_TABS = [
  { id: "profile", label: "Profile" },
  { id: "security", label: "Security" },
  { id: "preferences", label: "Preferences" },
  { id: "notifications", label: "Notifications" },
  { id: "developer", label: "API & agents" },
] as const;

export const BUDGET_TABS = [
  { id: "general", label: "General" },
  { id: "sharing", label: "Sharing" },
  { id: "rates", label: "Exchange rates" },
  { id: "ai", label: "AI" },
  { id: "data", label: "Backup & data" },
] as const;

export type AccountTab = (typeof ACCOUNT_TABS)[number]["id"];
export type BudgetTab = (typeof BUDGET_TABS)[number]["id"];

export const ACCOUNT_TAB_IDS = ACCOUNT_TABS.map((t) => t.id) as [AccountTab, ...AccountTab[]];
export const BUDGET_TAB_IDS = BUDGET_TABS.map((t) => t.id) as [BudgetTab, ...BudgetTab[]];

type Entry = {
  title: string;
  /** Other words people search for it by. */
  keywords?: string[];
  /** The element id of the section that holds it. */
  section: string;
} & (
  | { page: "account"; tab: AccountTab }
  | {
      page: "budget";
      tab: BudgetTab;
      /** Hidden from the budget's members below this role, as the section is. */
      minRole?: "editor" | "owner";
    }
);

export const SETTINGS: readonly Entry[] = [
  {
    page: "account",
    tab: "profile",
    section: "profile-picture",
    title: "Profile picture",
    keywords: ["photo", "avatar", "image"],
  },
  {
    page: "account",
    tab: "profile",
    section: "first-name",
    title: "First name",
    keywords: ["name"],
  },
  {
    page: "account",
    tab: "profile",
    section: "email",
    title: "Email",
    keywords: ["change email", "address", "sign in"],
  },
  {
    page: "account",
    tab: "profile",
    section: "delete-account",
    title: "Delete account",
    keywords: ["close account", "remove"],
  },
  {
    page: "account",
    tab: "security",
    section: "password",
    title: "Password",
    keywords: ["change password"],
  },
  {
    page: "account",
    tab: "security",
    section: "two-step",
    title: "Two-step verification",
    keywords: ["2fa", "two-factor", "authenticator", "backup codes", "mfa"],
  },
  {
    page: "account",
    tab: "security",
    section: "devices",
    title: "Devices",
    keywords: ["sessions", "sign out", "signed in", "log out"],
  },
  {
    page: "account",
    tab: "preferences",
    section: "options",
    title: "Open last used budget by default",
    keywords: ["options", "start"],
  },
  {
    page: "account",
    tab: "preferences",
    section: "options",
    title: "Keyboard shortcuts",
    keywords: ["options", "hotkeys", "keys"],
  },
  {
    page: "account",
    tab: "preferences",
    section: "options",
    title: "Show account totals in",
    keywords: ["display currency", "net worth", "convert"],
  },
  {
    page: "account",
    tab: "notifications",
    section: "notifications",
    title: "Monthly summary email",
    keywords: ["notifications", "email", "unsubscribe", "summary", "report"],
  },
  {
    page: "account",
    tab: "notifications",
    section: "notifications",
    title: "AI overview in summaries",
    keywords: ["notifications", "email", "ai"],
  },
  {
    page: "account",
    tab: "developer",
    section: "api-keys",
    title: "API keys",
    keywords: ["token", "scripts", "developer"],
  },
  {
    page: "account",
    tab: "developer",
    section: "connected-agents",
    title: "Connected agents",
    keywords: ["mcp", "claude", "oauth", "disconnect"],
  },
  {
    page: "budget",
    tab: "general",
    section: "general",
    title: "Budget name",
    keywords: ["rename"],
  },
  { page: "budget", tab: "general", section: "general", title: "Currency" },
  {
    page: "budget",
    tab: "general",
    section: "general",
    title: "Number format",
    keywords: ["decimal", "separator"],
  },
  { page: "budget", tab: "general", section: "general", title: "Currency symbol position" },
  { page: "budget", tab: "general", section: "general", title: "Date format" },
  {
    page: "budget",
    tab: "general",
    section: "payees",
    title: "Payees",
    keywords: ["manage payees", "rename", "combine", "merge"],
    minRole: "editor",
  },
  {
    page: "budget",
    tab: "sharing",
    section: "sharing",
    title: "Members",
    keywords: ["sharing", "invite", "partner", "share", "roles"],
  },
  {
    page: "budget",
    tab: "rates",
    section: "exchange-rates",
    title: "Exchange rates",
    keywords: ["currency", "conversion", "fx"],
  },
  {
    page: "budget",
    tab: "ai",
    section: "ai",
    title: "AI features",
    keywords: ["assistant", "chat"],
  },
  {
    page: "budget",
    tab: "ai",
    section: "ai",
    title: "Floating chat button",
    keywords: ["assistant", "chat"],
  },
  {
    page: "budget",
    tab: "ai",
    section: "ai",
    title: "Use your own agent",
    keywords: ["mcp", "claude", "cursor"],
  },
  {
    page: "budget",
    tab: "data",
    section: "backup",
    title: "Download backup",
    keywords: ["export", "file"],
  },
  {
    page: "budget",
    tab: "data",
    section: "fresh-start",
    title: "Fresh start",
    keywords: ["start over", "archive"],
    minRole: "owner",
  },
  {
    page: "budget",
    tab: "data",
    section: "delete-budget",
    title: "Delete budget",
    keywords: ["remove"],
    minRole: "owner",
  },
];

export type SettingsMatch = Entry & {
  where: string;
};

const RANK: Record<BudgetRole, number> = { viewer: 0, editor: 1, owner: 2 };

/**
 * The settings matching a query, best first: titles starting with it, then titles containing it,
 * then a keyword. Budget settings are left out without a budget (`role` null), and those the
 * role can't see are too.
 */
export function searchSettings(query: string, role: BudgetRole | null): SettingsMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: { entry: Entry; score: number; order: number }[] = [];
  SETTINGS.forEach((entry, order) => {
    if (!canSee(entry, role)) return;
    const title = entry.title.toLowerCase();
    const score = title.startsWith(q)
      ? 0
      : title.includes(q)
        ? 1
        : entry.keywords?.some((k) => k.includes(q))
          ? 2
          : null;
    if (score !== null) scored.push({ entry, score, order });
  });
  return scored
    .sort((a, b) => a.score - b.score || a.order - b.order)
    .map(({ entry }) => ({ ...entry, where: whereLabel(entry) }));
}

/** Every setting this person can see, in the pages' order (the command palette lists them). */
export function visibleSettings(role: BudgetRole | null): SettingsMatch[] {
  return SETTINGS.filter((entry) => canSee(entry, role)).map((entry) => ({
    ...entry,
    where: whereLabel(entry),
  }));
}

/** The element id of a settings section, which a link names in its hash to scroll to it. */
export const settingsSectionId = (section: string) => `settings-${section}`;

/** Budget settings need a budget (`role`), and some a role above viewer. */
function canSee(entry: Entry, role: BudgetRole | null) {
  if (entry.page === "account") return true;
  return role !== null && (!entry.minRole || RANK[role] >= RANK[entry.minRole]);
}

function whereLabel(entry: Entry) {
  const tabs: readonly { id: string; label: string }[] =
    entry.page === "account" ? ACCOUNT_TABS : BUDGET_TABS;
  const tab = tabs.find((t) => t.id === entry.tab)?.label;
  return `${entry.page === "account" ? "Account settings" : "Budget settings"} › ${tab}`;
}
