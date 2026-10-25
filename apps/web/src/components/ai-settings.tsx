import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@strictbudget/ui/components/field";
import { Skeleton } from "@strictbudget/ui/components/skeleton";
import { Switch } from "@strictbudget/ui/components/switch";
import { Calculator, ChartColumn, CircleAlert, MessageSquareText, SquarePen } from "lucide-react";
import { McpSetup } from "@/components/agent-setup";
import { aiUnavailableMessage, useAiSettings, useUpdateAiSettings } from "@/lib/ai";

const CAPABILITIES = [
  {
    icon: MessageSquareText,
    title: "Chat with your budget",
    description: "Ask what's left in a category, or where your money went last month.",
  },
  {
    icon: SquarePen,
    title: "Make changes for you",
    description: "Add or fix transactions and assign money. Nothing changes until you approve it.",
  },
  {
    icon: ChartColumn,
    title: "Show it in charts",
    description: "See spending, income and trends as bar, line or pie charts.",
  },
  {
    icon: Calculator,
    title: "Exact numbers",
    description: "Totals and percentages are calculated, never guessed.",
  },
] as const;

/**
 * The budget's AI settings: what the in-app AI does and its two switches (AI features, and the
 * floating chat button), then how to connect an outside agent over MCP. Used in budget setup and
 * budget settings.
 */
export function AiSettingsFields({ budgetId, canEdit }: { budgetId: string; canEdit: boolean }) {
  return (
    <FieldGroup>
      <FieldSet>
        <FieldLegend>In-app AI</FieldLegend>
        <FieldDescription>
          AI features are for this budget only, and for everyone on it. The AI can't see or change a
          budget where they're off.
        </FieldDescription>
        <ul className="grid gap-3 sm:grid-cols-2">
          {CAPABILITIES.map(({ icon: Icon, title, description }) => (
            <li key={title} className="flex gap-3 rounded-lg border p-3">
              <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="grid gap-0.5">
                <p className="font-medium text-sm">{title}</p>
                <p className="text-muted-foreground text-sm">{description}</p>
              </div>
            </li>
          ))}
        </ul>
        <AiSwitches budgetId={budgetId} canEdit={canEdit} />
      </FieldSet>
      <FieldSeparator />
      <FieldSet>
        <FieldLegend>Use your own agent</FieldLegend>
        <FieldDescription>
          Connect Claude, Cursor or another agent to strictbudget over MCP. It works whether or not
          in-app AI is on.
        </FieldDescription>
        <McpSetup />
      </FieldSet>
    </FieldGroup>
  );
}

function AiSwitches({ budgetId, canEdit }: { budgetId: string; canEdit: boolean }) {
  const settings = useAiSettings(budgetId);
  const update = useUpdateAiSettings(budgetId);
  if (!settings.data) return <Skeleton className="h-28" />;
  const { available, unavailableReason, enabled, assistantButton } = settings.data;
  const unavailable = aiUnavailableMessage(unavailableReason);
  return (
    <>
      {unavailable && (
        <p
          role="status"
          className="flex gap-2 rounded-lg border border-dashed p-3 text-muted-foreground text-sm"
        >
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {unavailable}
        </p>
      )}
      <Field orientation="horizontal" data-disabled={!available || !canEdit || undefined}>
        <FieldContent>
          <FieldLabel htmlFor="ai-enabled">Turn on AI features</FieldLabel>
          <FieldDescription>
            {canEdit
              ? "Chat with this budget; it changes things only when you approve. The AI assistant shows in the sidebar."
              : "Only the budget's owner and editors can change this."}
          </FieldDescription>
        </FieldContent>
        <Switch
          id="ai-enabled"
          checked={enabled}
          disabled={!available || !canEdit}
          onCheckedChange={(checked) => update({ enabled: checked })}
        />
      </Field>
      <Field orientation="horizontal" data-disabled={!enabled || !canEdit || undefined}>
        <FieldContent>
          <FieldLabel htmlFor="ai-assistant-button">Floating chat button</FieldLabel>
          <FieldDescription>
            {enabled
              ? "Also show a chat button at the bottom right of every page, to ask the AI without leaving the page. The AI assistant in the sidebar stays either way."
              : "Turn on AI features first."}
          </FieldDescription>
        </FieldContent>
        <Switch
          id="ai-assistant-button"
          checked={assistantButton}
          disabled={!enabled || !canEdit}
          onCheckedChange={(checked) => update({ assistantButton: checked })}
        />
      </Field>
    </>
  );
}
