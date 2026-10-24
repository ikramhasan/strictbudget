import {
  Autocomplete,
  AutocompleteContent,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
} from "@strictbudget/ui/components/autocomplete";
import { InputGroupAddon } from "@strictbudget/ui/components/input-group";
import { Tabs, TabsList, TabsTrigger } from "@strictbudget/ui/components/tabs";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { PageTitle } from "@/components/page-title";
import {
  type BudgetRole,
  type SettingsMatch,
  searchSettings,
  settingsSectionId as sectionId,
} from "@/lib/settings-index";

/**
 * Account and Budget settings: the page's tabs, one group of settings each, and a search over
 * every setting on both pages in the top bar. The tabs' content goes in as `TabsContent`.
 */
export function SettingsLayout<Tab extends string>({
  title,
  tabs,
  tab,
  onTabChange,
  budget,
  children,
}: {
  title: string;
  tabs: readonly { id: Tab; label: string }[];
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  /** The budget whose settings the search reaches; null when there's none to go to. */
  budget: { id: string; role: BudgetRole } | null;
  children: ReactNode;
}) {
  // A search result (or a link) names its section in the hash: scroll to it once its tab shows.
  // The search's navigation keeps the scroll, so the router doesn't take it back to the top.
  const hash = useLocation({ select: (l) => l.hash });
  useEffect(() => {
    const section = hash ? document.getElementById(hash) : null;
    if (!section) return;
    const scroll = () => section.scrollIntoView({ block: "start" });
    scroll();
    // On a page just opened, the tab's cards are still loading and the page is too short to
    // scroll that far: follow the section while they grow, for a moment.
    const observer = new ResizeObserver(scroll);
    observer.observe(section.parentElement ?? section);
    const stop = setTimeout(() => observer.disconnect(), 1500);
    return () => {
      clearTimeout(stop);
      observer.disconnect();
    };
  }, [hash, tab]);
  return (
    // The page edge matches the other pages; the settings keep a readable column.
    <div className="mx-auto grid w-full max-w-6xl grid-cols-[minmax(0,42rem)] content-start">
      <PageTitle name={title} />
      <PageHeader title={title} actions={<SettingsSearch budget={budget} />} />
      <Tabs value={tab} onValueChange={(value) => onTabChange(value as Tab)} className="gap-6">
        {/* On a phone the tabs scroll sideways rather than wrap. */}
        <div className="-mx-1 overflow-x-auto px-1 pb-[3px] [scrollbar-width:none]">
          <TabsList variant="line" aria-label={title}>
            {tabs.map((t) => (
              <TabsTrigger key={t.id} value={t.id} className="flex-none px-2">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {children}
      </Tabs>
    </div>
  );
}

/** One section of a settings tab: what the search scrolls to. */
export function SettingsSection({ id, children }: { id: string; children: ReactNode }) {
  return (
    <section id={sectionId(id)} className="scroll-mt-4">
      {children}
    </section>
  );
}

/** A setting found by the search, keyed by where it is so each is unique. */
type Item = SettingsMatch & { value: string };

function SettingsSearch({ budget }: { budget: { id: string; role: BudgetRole } | null }) {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const items = useMemo<Item[]>(
    () =>
      searchSettings(text, budget?.role ?? null).map((m) => ({
        ...m,
        value: `${m.where} › ${m.title}`,
      })),
    [text, budget?.role],
  );

  async function go(item: Item) {
    setText("");
    setOpen(false);
    const hash = sectionId(item.section);
    if (item.page === "account")
      await navigate({ to: "/account", search: { tab: item.tab }, hash, resetScroll: false });
    else if (budget)
      await navigate({
        to: "/budgets/$budgetId/settings",
        params: { budgetId: budget.id },
        search: { tab: item.tab },
        hash,
        resetScroll: false,
      });
  }

  return (
    <Autocomplete
      items={items}
      filter={null}
      value={text}
      open={open && text.trim() !== ""}
      onOpenChange={setOpen}
      itemToStringValue={(item: Item) => item.value}
      onValueChange={(next, details) => {
        if (details.reason === "item-press") {
          const item = items.find((i) => i.value === next);
          if (item) return void go(item);
        }
        setText(next);
        setOpen(true);
      }}
    >
      <AutocompleteInput
        aria-label="Search settings"
        placeholder="Search"
        showTrigger={false}
        className="h-8 w-56 transition-[width] focus-within:w-72 max-md:h-11 max-md:w-36 max-md:focus-within:w-48"
      >
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
      </AutocompleteInput>
      <AutocompleteContent align="end" className="w-80 max-md:w-[calc(100vw-2rem)]">
        <AutocompleteEmpty>No settings match.</AutocompleteEmpty>
        <AutocompleteList>
          {(item: Item) => (
            <AutocompleteItem
              key={item.value}
              value={item}
              className="flex-col items-start gap-0 py-1.5"
            >
              <span>{item.title}</span>
              <span className="text-muted-foreground text-xs">{item.where}</span>
            </AutocompleteItem>
          )}
        </AutocompleteList>
      </AutocompleteContent>
    </Autocomplete>
  );
}
