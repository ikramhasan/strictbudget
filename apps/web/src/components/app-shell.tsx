import { Avatar, AvatarFallback, AvatarImage } from "@strictbudget/ui/components/avatar";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@strictbudget/ui/components/dropdown-menu";
import { Kbd, KbdGroup } from "@strictbudget/ui/components/kbd";
import { ScrollArea } from "@strictbudget/ui/components/scroll-area";
import { Separator } from "@strictbudget/ui/components/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@strictbudget/ui/components/sidebar";
import { type Theme, useTheme } from "@strictbudget/ui/lib/theme";
import { cn } from "@strictbudget/ui/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useNavigate, useParams } from "@tanstack/react-router";
import {
  Activity,
  ChartColumn,
  ChevronsUpDown,
  Keyboard,
  Landmark,
  LayoutGrid,
  LogOut,
  Menu,
  Search,
  Settings,
  Sparkles,
  UserCog,
  Wallet,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useAiSettings } from "@/lib/ai";
import { authClient } from "@/lib/auth-client";
import { budgetQueryOptions, budgetsQueryOptions } from "@/lib/budgets";
import { CommandRegistryProvider } from "@/lib/commands";
import { lastViewedMonth } from "@/lib/months";
import { pictureSrc } from "@/lib/pictures";
import { capLabel, useShortcut } from "@/lib/shortcuts";
import { AccountsNav } from "./accounts-nav";
import { BudgetSwitcher } from "./budget-switcher";
import { CommandPalette } from "./command-palette";
import { KeyboardShortcutsDialog } from "./keyboard-shortcuts-dialog";
import { PageHeaderSlotProvider } from "./page-header";
import { SidebarDropdownContent } from "./sidebar-dropdown-content";

const THEMES: readonly { value: Theme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

/**
 * A theme choice in the user menu: an equal share of the row, its label never pushing it wider, the
 * chosen one filled. The radio item's check (`[data-slot=...indicator]`) is hidden; the fill shows it.
 */
const THEME_ITEM =
  "min-w-0 flex-1 justify-center rounded-none border-l px-1 py-1.5 text-xs first:border-l-0 data-[state=checked]:bg-muted data-[state=checked]:font-medium [&>[data-slot=dropdown-menu-radio-item-indicator]]:hidden";

/** The page's scrolling element: the router resets it to the top on navigation and restores it. */
export const APP_SCROLL_ID = "app-scroll";

export function AppShell({
  user,
}: {
  user: { name: string; email: string; image?: string | null };
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { budgetId } = useParams({ strict: false });
  const budgets = useQuery(budgetsQueryOptions());
  // Same query the budget route loads, so this reads the cache rather than fetching again.
  const currentBudget = useQuery({
    ...budgetQueryOptions(budgetId ?? ""),
    enabled: Boolean(budgetId),
  });

  const { theme, setTheme } = useTheme();
  const [helpOpen, setHelpOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useSidebarWidth();
  const [resizing, setResizing] = useState(false);
  // The top bar's header slot, where each page puts its title and actions.
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);

  async function signOut() {
    await authClient.signOut();
    queryClient.clear();
    await navigate({ to: "/sign-in" });
  }

  const initials = user.name
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

  // The AI assistant is in the sidebar whenever the budget has AI on (viewers can't use it).
  const aiSettings = useAiSettings(budgetId);
  const aiOn = aiSettings.data?.enabled && currentBudget.data?.role !== "viewer";

  return (
    // The screens offer their actions to the command palette through this.
    <CommandRegistryProvider>
      <SidebarProvider
        // A tablet starts with the icon rail, leaving the page the room; the trigger opens it.
        defaultOpen={window.innerWidth >= 1024}
        style={
          {
            "--sidebar-width": `${sidebarWidth}px`,
            "--sidebar-width-icon": "3.5rem",
          } as React.CSSProperties
        }
        data-sidebar-narrow={sidebarWidth < SIDEBAR.narrow || undefined}
        data-sidebar-resizing={resizing || undefined}
        className="data-[sidebar-resizing]:[&_[data-slot=sidebar-container]]:transition-none data-[sidebar-resizing]:[&_[data-slot=sidebar-gap]]:transition-none"
      >
        <GlobalShortcuts
          onHelp={() => setHelpOpen(true)}
          onPalette={() => setPaletteOpen((open) => !open)}
        />
        <KeyboardShortcutsDialog open={helpOpen} onOpenChange={setHelpOpen} />
        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          budget={budgetId ? currentBudget.data : undefined}
          budgets={budgets.data?.budgets ?? []}
          aiOn={Boolean(aiOn)}
          onSignOut={() => void signOut()}
        />
        <Sidebar collapsible="icon">
          {/* One landmark for the sidebar, so everything in it is in a region. */}
          <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col">
            <SidebarResizer
              width={sidebarWidth}
              onWidth={setSidebarWidth}
              onResizing={setResizing}
            />
            <SidebarHeader>
              <SidebarMenu>
                <SidebarMenuItem>
                  <BudgetSwitcher
                    // Most recently used first; archived ones too.
                    budgets={budgets.data?.budgets ?? []}
                    currentBudgetId={budgetId}
                  />
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarHeader>
            <SidebarContent>
              <SidebarGroup>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <PaletteButton onOpen={() => setPaletteOpen(true)} />
                  </SidebarMenuItem>
                  {budgetId ? (
                    <>
                      <SidebarMenuItem>
                        <SidebarMenuButton asChild tooltip="Budget">
                          <Link
                            to="/budgets/$budgetId"
                            params={{ budgetId }}
                            // Back to the month last viewed.
                            search={{ month: lastViewedMonth(budgetId) }}
                            activeOptions={{ exact: true, includeSearch: false }}
                            activeProps={{ "data-active": true }}
                          >
                            <Wallet />
                            <span>Budget</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                      <SidebarMenuItem>
                        <SidebarMenuButton asChild tooltip="Reports">
                          <Link
                            to="/budgets/$budgetId/reports"
                            params={{ budgetId }}
                            activeProps={{ "data-active": true }}
                          >
                            <ChartColumn />
                            <span>Reports</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                      <SidebarMenuItem>
                        <SidebarMenuButton asChild tooltip="All Accounts">
                          <Link
                            to="/budgets/$budgetId/accounts"
                            params={{ budgetId }}
                            activeOptions={{ exact: true }}
                            activeProps={{ "data-active": true }}
                          >
                            <Landmark />
                            <span>All Accounts</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                      <SidebarMenuItem>
                        <SidebarMenuButton asChild tooltip="Activity">
                          <Link
                            to="/budgets/$budgetId/activity"
                            params={{ budgetId }}
                            activeProps={{ "data-active": true }}
                          >
                            <Activity />
                            <span>Activity</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                      {aiOn && (
                        <SidebarMenuItem>
                          <SidebarMenuButton asChild tooltip="AI assistant">
                            <Link
                              to="/budgets/$budgetId/ai"
                              params={{ budgetId }}
                              activeProps={{ "data-active": true }}
                            >
                              <Sparkles />
                              <span>AI assistant</span>
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      )}
                      <SidebarMenuItem>
                        <SidebarMenuButton asChild tooltip="Budget settings">
                          <Link
                            to="/budgets/$budgetId/settings"
                            params={{ budgetId }}
                            activeProps={{ "data-active": true }}
                          >
                            <Settings />
                            <span>Budget settings</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    </>
                  ) : (
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild tooltip="All budgets">
                        <Link to="/budgets" activeProps={{ "data-active": true }}>
                          <LayoutGrid />
                          <span>All budgets</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )}
                </SidebarMenu>
              </SidebarGroup>
              {budgetId && currentBudget.data && (
                // The icon rail leaves the accounts out; widening the sidebar brings them back.
                <div className="group-data-[collapsible=icon]:hidden">
                  <AccountsNav budget={currentBudget.data} />
                </div>
              )}
            </SidebarContent>
            <SidebarFooter>
              <SidebarMenu>
                <SidebarMenuItem>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <SidebarMenuButton size="lg">
                        {/* A profile picture is a circle; initials keep the square. */}
                        <Avatar
                          className={cn("size-8", user.image ? "rounded-full" : "rounded-lg")}
                        >
                          {user.image && <AvatarImage src={pictureSrc(user.image)} alt="" />}
                          <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
                        </Avatar>
                        <div className="grid flex-1 text-left text-sm leading-tight">
                          <span className="truncate font-medium">{user.name}</span>
                          <span className="truncate text-muted-foreground text-xs">
                            {user.email}
                          </span>
                        </div>
                        <ChevronsUpDown className="ml-auto size-4" />
                      </SidebarMenuButton>
                    </DropdownMenuTrigger>
                    <SidebarDropdownContent side="top" align="start" railAlign="end">
                      <DropdownMenuLabel className="truncate">{user.email}</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem asChild>
                        <Link to="/account">
                          <UserCog /> Account settings
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setHelpOpen(true)}>
                        <Keyboard /> Keyboard Shortcuts
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {/*
                       * Theme as a button group; picking one keeps the menu open. Text only, so the three
                       * share the menu's width (as wide as the sidebar's user button) evenly.
                       */}
                      <div className="grid gap-1.5 px-2 py-1.5">
                        <span className="text-muted-foreground text-xs">Theme</span>
                        {/*
                         * Menu radio items, laid out as a joined button group: the menu's arrow keys
                         * reach them (a ToggleGroup inside a menu can't be focused from the keyboard),
                         * and picking one keeps the menu open.
                         */}
                        <DropdownMenuRadioGroup
                          aria-label="Theme"
                          value={theme}
                          onValueChange={(value) => setTheme(value as Theme)}
                          className="flex overflow-hidden rounded-md border"
                        >
                          {THEMES.map(({ value, label }) => (
                            <DropdownMenuRadioItem
                              key={value}
                              value={value}
                              onSelect={(event) => event.preventDefault()}
                              className={THEME_ITEM}
                            >
                              {label}
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      </div>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={signOut}>
                        <LogOut /> Sign out
                      </DropdownMenuItem>
                    </SidebarDropdownContent>
                  </DropdownMenu>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarFooter>
          </nav>
        </Sidebar>
        {/*
         * The page scrolls inside an overlay ScrollArea under a fixed top bar, never the window: the
         * scrollbar matches the tables', the bar stays in view, and a dropdown's scroll lock (which
         * hides the window's scrollbar) has nothing to hide.
         */}
        <SidebarInset className="h-svh overflow-hidden">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4 data-vertical:self-center" />
            <div ref={setHeaderSlot} className="flex min-w-0 flex-1 items-center gap-2" />
          </header>
          <ScrollArea
            className="min-h-0 flex-1"
            // Radix wraps the content in a `display: table` box, which stops long text truncating.
            viewportClassName="[&>div]:block!"
            viewportProps={{ id: APP_SCROLL_ID, "data-scroll-restoration-id": APP_SCROLL_ID }}
          >
            {/* On a phone the page clears the bottom navigation bar and the home indicator. */}
            <div className="p-4 pb-[calc(5rem+env(safe-area-inset-bottom))] md:p-5">
              <PageHeaderSlotProvider value={headerSlot}>
                <Outlet />
              </PageHeaderSlotProvider>
            </div>
          </ScrollArea>
          {budgetId && <BottomNav budgetId={budgetId} />}
        </SidebarInset>
      </SidebarProvider>
    </CommandRegistryProvider>
  );
}

/**
 * The shell's shortcuts: "?" for the list, Shift+. for the sidebar, and Cmd/Ctrl+K for the
 * command palette, which works from a text field too.
 */
function GlobalShortcuts({ onHelp, onPalette }: { onHelp: () => void; onPalette: () => void }) {
  const { toggleSidebar } = useSidebar();
  useShortcut("help", onHelp);
  useShortcut("sidebar", toggleSidebar);
  useShortcut("palette", onPalette, { allowIn: anyField });
  return null;
}

const anyField = () => true;

/** The command palette's entry in the sidebar, with its keys; on a phone it closes the sheet. */
function PaletteButton({ onOpen }: { onOpen: () => void }) {
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <SidebarMenuButton
      tooltip="Search"
      onClick={() => {
        if (isMobile) setOpenMobile(false);
        onOpen();
      }}
    >
      <Search />
      <span>Search</span>
      {!isMobile && (
        <KbdGroup aria-hidden className="ml-auto group-data-[collapsible=icon]:hidden">
          <Kbd>{capLabel("mod")}</Kbd>
          <Kbd>K</Kbd>
        </KbdGroup>
      )}
    </SidebarMenuButton>
  );
}

const SIDEBAR = {
  /** Narrower than the kit's 16rem, leaving the page more room. */
  default: 224,
  /** Under this a drag folds it to the icon rail. */
  rail: 150,
  /** Under this the account balances hide. */
  narrow: 220,
  max: 600,
};
const SIDEBAR_WIDTH_KEY = "strictbudget:sidebar-width";

/** The width last dragged to, kept in this browser. */
function useSidebarWidth() {
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
      return saved >= SIDEBAR.rail && saved <= SIDEBAR.max ? saved : SIDEBAR.default;
    } catch {
      return SIDEBAR.default;
    }
  });
  const save = useCallback((next: number) => {
    setWidth(next);
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(next));
    } catch {
      // Storage can be unavailable (private windows); the width still holds for this visit.
    }
  }, []);
  return [width, save] as const;
}

/**
 * The sidebar's right edge, dragged to resize it: 150–600px, and narrower than that
 * folds it to the icon rail (dragging out again opens it). Arrow keys move it 16px.
 * Hand-rolled: shadcn's Sidebar is a fixed panel sized by a CSS variable, which a panel library
 * (they lay out both sides in one group) can't drive.
 */
function SidebarResizer({
  width,
  onWidth,
  onResizing,
}: {
  width: number;
  onWidth: (width: number) => void;
  onResizing: (resizing: boolean) => void;
}) {
  const { open, setOpen, isMobile } = useSidebar();
  // The width a drag started from: folding to the rail keeps it, to reopen at.
  const startWidth = useRef(width);
  if (isMobile) return null;

  function moveTo(x: number) {
    if (x < SIDEBAR.rail) {
      setOpen(false);
      onWidth(startWidth.current);
      return;
    }
    if (!open) setOpen(true);
    onWidth(Math.min(SIDEBAR.max, Math.round(x)));
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable splitter has no element of its own
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the sidebar"
      aria-valuemin={SIDEBAR.rail}
      aria-valuemax={SIDEBAR.max}
      aria-valuenow={open ? width : 0}
      tabIndex={0}
      className="absolute inset-y-0 -right-1 z-20 w-2 cursor-ew-resize outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:bg-transparent hover:after:bg-sidebar-border focus-visible:after:bg-ring"
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        startWidth.current = open ? width : SIDEBAR.default;
        onResizing(true);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) moveTo(e.clientX);
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        onResizing(false);
      }}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        // From the rail, Right opens it at the width it had.
        if (!open) {
          if (e.key === "ArrowRight") setOpen(true);
          return;
        }
        startWidth.current = width;
        moveTo(width + (e.key === "ArrowRight" ? 16 : -16));
      }}
    />
  );
}

/**
 * A phone's main places within thumb reach:
 * Budget, All Accounts, Reports and Activity, and More for the rest of the sidebar (the accounts,
 * settings, the user menu). Hidden from tablet width up, where the sidebar shows.
 */
function BottomNav({ budgetId }: { budgetId: string }) {
  const { setOpenMobile } = useSidebar();
  const item =
    "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[0.7rem] text-muted-foreground outline-none focus-visible:bg-muted data-[active]:font-medium data-[active]:text-foreground [&_svg]:size-5";
  return (
    <nav
      aria-label="Quick navigation"
      className="fixed inset-x-0 bottom-0 z-30 flex border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <Link
        to="/budgets/$budgetId"
        params={{ budgetId }}
        search={{ month: lastViewedMonth(budgetId) }}
        activeOptions={{ exact: true, includeSearch: false }}
        activeProps={{ "data-active": true, "aria-current": "page" }}
        className={item}
      >
        <Wallet aria-hidden /> Budget
      </Link>
      <Link
        to="/budgets/$budgetId/accounts"
        params={{ budgetId }}
        activeProps={{ "data-active": true, "aria-current": "page" }}
        className={item}
      >
        <Landmark aria-hidden /> Accounts
      </Link>
      <Link
        to="/budgets/$budgetId/reports"
        params={{ budgetId }}
        activeProps={{ "data-active": true, "aria-current": "page" }}
        className={item}
      >
        <ChartColumn aria-hidden /> Reports
      </Link>
      <Link
        to="/budgets/$budgetId/activity"
        params={{ budgetId }}
        activeProps={{ "data-active": true, "aria-current": "page" }}
        className={item}
      >
        <Activity aria-hidden /> Activity
      </Link>
      <button type="button" className={item} onClick={() => setOpenMobile(true)}>
        <Menu aria-hidden /> More
      </button>
    </nav>
  );
}
