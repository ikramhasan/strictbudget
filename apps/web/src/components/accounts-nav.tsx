import { move } from "@dnd-kit/helpers";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { formatAmount, money } from "@strictbudget/engine";
import { Button } from "@strictbudget/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@strictbudget/ui/components/collapsible";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@strictbudget/ui/components/sidebar";
import { cn } from "@strictbudget/ui/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRight, GripVertical, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  type Account,
  accountsQueryOptions,
  type SidebarSection,
  sidebarSections,
  totalHint,
} from "@/lib/accounts";
import { $api } from "@/lib/api";
import { apiErrorMessage, type Budget } from "@/lib/budgets";
import { nextId } from "@/lib/categories";
import { todayIso } from "@/lib/dates";
import { inCurrency } from "@/lib/money-input";
import { pictureSrc } from "@/lib/pictures";
import { AddAccountDialog } from "./add-account-dialog";

/**
 * The sidebar's account list: sections by type with totals, drag to reorder. A starred account
 * shows twice (Starred and its own group); each group has its own order.
 */
export function AccountsNav({ budget }: { budget: Budget }) {
  const queryClient = useQueryClient();
  const accounts = useQuery(accountsQueryOptions(budget.id));
  const moveAccount = $api.useMutation("post", "/v1/budgets/{budgetId}/accounts/{accountId}/move");
  const [adding, setAdding] = useState(false);

  const serverSections = useMemo(
    () => sidebarSections(accounts.data?.accounts ?? [], budget.currency, accounts.data?.totals),
    [accounts.data, budget.currency],
  );
  // Local order per section so a drag shows immediately.
  const [order, setOrder] = useState<Record<string, string[]>>({});
  useEffect(() => {
    setOrder(Object.fromEntries(serverSections.map((s) => [s.id, s.accounts.map((a) => a.id)])));
  }, [serverSections]);

  const byId = useMemo(
    () => new Map((accounts.data?.accounts ?? []).map((a) => [a.id, a])),
    [accounts.data],
  );
  /** An amount in `currency` (an account's own), the budget's by default. */
  const format = (minorUnits: bigint, currency?: string) =>
    formatAmount(money(minorUnits, inCurrency(budget, currency).currency), budget);

  async function handleMove(accountId: string, beforeAccountId: string | null, starred: boolean) {
    try {
      const result = await moveAccount.mutateAsync({
        params: { path: { budgetId: budget.id, accountId }, query: { today: todayIso() } },
        body: { beforeAccountId, ...(starred && { starred }) },
      });
      queryClient.setQueryData(accountsQueryOptions(budget.id).queryKey, result);
    } catch (error) {
      toast.error(apiErrorMessage(error, "Couldn't move the account."));
      await queryClient.invalidateQueries({ queryKey: accountsQueryOptions(budget.id).queryKey });
    }
  }

  return (
    <>
      <DragDropProvider
        onDragOver={(event) => {
          const section = event.operation.source?.data?.section as string | undefined;
          if (!section) return;
          // Sortable ids are `section:accountId`; the order keeps account ids.
          const prefix = `${section}:`;
          setOrder((o) => ({
            ...o,
            [section]: move(
              (o[section] ?? []).map((id) => prefix + id),
              event,
            ).map((key) => key.slice(prefix.length)),
          }));
        }}
        onDragEnd={(event) => {
          const source = event.operation.source;
          if (event.canceled || !source) {
            setOrder(
              Object.fromEntries(serverSections.map((s) => [s.id, s.accounts.map((a) => a.id)])),
            );
            return;
          }
          const id = source.data?.accountId as string;
          const section = source.data?.section as string;
          const now = order[section] ?? [];
          const was = serverSections.find((s) => s.id === section)?.accounts.map((a) => a.id) ?? [];
          if (nextId(now, id) !== nextId(was, id)) {
            void handleMove(id, nextId(now, id), section === "starred");
          }
        }}
      >
        {serverSections.map((section) => (
          <AccountSection
            key={section.id}
            section={section}
            ids={order[section.id] ?? section.accounts.map((a) => a.id)}
            byId={byId}
            budgetId={budget.id}
            format={format}
            reorderable={budget.role !== "viewer"}
          />
        ))}
      </DragDropProvider>

      {budget.role !== "viewer" && (
        <SidebarGroup>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAdding(true)}
            className="justify-start"
          >
            <Plus /> Add Account
          </Button>
        </SidebarGroup>
      )}

      <AddAccountDialog budget={budget} open={adding} onOpenChange={setAdding} />
    </>
  );
}

function AccountSection({
  section,
  ids,
  byId,
  budgetId,
  format,
  reorderable,
}: {
  section: SidebarSection;
  ids: string[];
  byId: Map<string, Account>;
  budgetId: string;
  format: (minorUnits: bigint, currency?: string) => string;
  reorderable: boolean;
}) {
  const hint = totalHint(section);
  return (
    <Collapsible defaultOpen={section.id !== "closed"} className="group/collapsible" asChild>
      <SidebarGroup>
        <SidebarGroupLabel asChild>
          <CollapsibleTrigger>
            <ChevronRight className="transition-transform group-data-[state=open]/collapsible:rotate-90" />
            <span className="uppercase tracking-wide">{section.title}</span>
            {section.id !== "closed" && (
              // Under 220px of sidebar the balances make way for the names.
              <span
                className="ml-auto tabular-nums [[data-sidebar-narrow]_&]:hidden"
                title={hint ?? undefined}
              >
                {section.converted && <span aria-hidden>≈</span>}
                {format(section.total, section.currency)}
                {/* The `*` marks accounts left out for want of a rate. */}
                {section.excluded.length > 0 && <span aria-hidden>*</span>}
                {hint && <span className="sr-only">, {hint}</span>}
              </span>
            )}
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        <CollapsibleContent>
          <SidebarGroupContent>
            <SidebarMenu>
              {ids.map((id, index) => {
                const account = byId.get(id);
                return account ? (
                  <AccountItem
                    key={id}
                    account={account}
                    index={index}
                    section={section.id}
                    budgetId={budgetId}
                    format={format}
                    reorderable={reorderable}
                  />
                ) : null;
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}

function AccountItem({
  account,
  index,
  section,
  budgetId,
  format,
  reorderable,
}: {
  account: Account;
  index: number;
  section: string;
  budgetId: string;
  format: (minorUnits: bigint, currency?: string) => string;
  /** False for a viewer, who can't reorder. */
  reorderable: boolean;
}) {
  const { ref, handleRef, isDragSource } = useSortable({
    // A starred account is in two sections, so its id here includes the section.
    id: `${section}:${account.id}`,
    index,
    group: section,
    type: `account-${section}`,
    accept: [`account-${section}`],
    data: { section, accountId: account.id },
    disabled: !reorderable,
  });
  const working = BigInt(account.balances.working);
  return (
    <SidebarMenuItem ref={ref} className={cn("group/account", isDragSource && "opacity-60")}>
      {/*
       * Dragging goes through a handle, so the row stays a list item with a link in it rather than
       * a button around one; without reordering the handle is an empty, hidden element.
       */}
      {reorderable ? (
        <button
          ref={handleRef}
          type="button"
          aria-label={`Reorder ${account.name}`}
          className="absolute top-1/2 left-1 z-10 grid h-6 w-3 -translate-y-1/2 cursor-grab touch-none place-items-center text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 active:cursor-grabbing group-hover/account:opacity-100 pointer-coarse:hidden"
        >
          <GripVertical className="size-3" />
        </button>
      ) : (
        <span ref={handleRef} hidden />
      )}
      <SidebarMenuButton asChild>
        <Link
          to="/budgets/$budgetId/accounts/$accountId"
          params={{ budgetId, accountId: account.id }}
          activeProps={{ "data-active": true }}
        >
          {/* The reorder handle shows over this slot on hover, inside the row's highlight. */}
          <span
            className={cn(
              "flex w-3 shrink-0 justify-center transition-opacity",
              reorderable &&
                "group-hover/account:opacity-0 group-has-[button:focus-visible]/account:opacity-0",
            )}
          >
            {account.toReview > 0 && (
              <span
                role="img"
                aria-label={`${account.toReview} to approve or categorize`}
                className="size-1.5 rounded-full bg-current"
              />
            )}
          </span>
          <AccountLogo name={account.name} logo={account.logo} />
          <span className="truncate">{account.name}</span>
        </Link>
      </SidebarMenuButton>
      {/* `!` beats the sidebar's active-item colour so money owed always reads red.
          Plain text, not the badge's recessed keycap. */}
      <SidebarMenuBadge
        className={cn(
          "bg-none tabular-nums shadow-none dark:bg-none dark:shadow-none [[data-sidebar-narrow]_&]:hidden",
          working < 0n && "text-destructive!",
        )}
      >
        {format(working, account.currency)}
      </SidebarMenuBadge>
    </SidebarMenuItem>
  );
}

/**
 * An account's leading icon: its logo, or its initial on a muted tile, so every
 * name starts in the same place.
 */
export function AccountLogo({
  name,
  logo,
  className,
}: {
  name: string;
  logo: string | null;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-[0.25rem] bg-muted font-semibold text-[0.5625rem] text-muted-foreground uppercase",
        className,
      )}
    >
      {[...name.trim()][0] ?? ""}
      {logo && (
        <img
          src={pictureSrc(logo)}
          alt=""
          loading="lazy"
          className="absolute inset-0 size-full bg-background object-cover"
          onError={(e) => {
            e.currentTarget.hidden = true;
          }}
        />
      )}
    </span>
  );
}
