import type { components } from "@strictbudget/api-client";
import {
  PAYEE_RULE_OPERATOR_LABELS,
  PAYEE_RULE_OPERATORS,
  type PayeeRuleOperator,
} from "@strictbudget/engine";
import { Button } from "@strictbudget/ui/components/button";
import { Input } from "@strictbudget/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@strictbudget/ui/components/native-select";
import { Minus, Plus, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { $api } from "@/lib/api";
import type { UndoCommand } from "@/lib/undo";

export type PayeeRule = components["schemas"]["PayeeRule"];

export const payeeRulesQueryOptions = (budgetId: string) =>
  $api.queryOptions("get", "/v1/budgets/{budgetId}/payees/rules", {
    params: { path: { budgetId } },
  });

/** Runs a change through Manage Payees' Undo (and refreshes what shows payees). */
type Run = (command: UndoCommand & { first?: () => Promise<void> }) => Promise<void>;

export function RenamingRulesGear() {
  return (
    <span title="Renaming rules applied" className="text-muted-foreground">
      <Settings className="size-3" aria-label="Renaming rules applied" />
    </span>
  );
}

export function PayeeRenamingRules({
  budgetId,
  payeeId,
  rules,
  run,
  disabled,
}: {
  budgetId: string;
  payeeId: string;
  rules: readonly PayeeRule[];
  run: Run;
  disabled?: boolean;
}) {
  const create = $api.useMutation("post", "/v1/budgets/{budgetId}/payees/{payeeId}/rules");
  const update = $api.useMutation("patch", "/v1/budgets/{budgetId}/payees/rules/{ruleId}");
  const remove = $api.useMutation("delete", "/v1/budgets/{budgetId}/payees/rules/{ruleId}");
  const [blankRow, setBlankRow] = useState(false);
  const showBlank = blankRow || rules.length === 0;

  /** Adds a rule; undo removes it and redo adds it again (as a new rule). */
  function addRule(operator: PayeeRuleOperator, text: string) {
    let id: string | null = null;
    const add = async () => {
      const rule = await create.mutateAsync({
        params: { path: { budgetId, payeeId } },
        body: { operator, text },
      });
      id = rule.id;
    };
    return run({
      label: "Add renaming rule",
      redo: add,
      undo: async () => {
        if (id) await remove.mutateAsync({ params: { path: { budgetId, ruleId: id } } });
      },
    });
  }

  /** Removes a rule; undo puts it back in its place (`index` among the payee's rules). */
  function removeRule(rule: PayeeRule, index: number) {
    let id = rule.id;
    return run({
      label: "Remove renaming rule",
      redo: async () => {
        await remove.mutateAsync({ params: { path: { budgetId, ruleId: id } } });
      },
      undo: async () => {
        const again = await create.mutateAsync({
          params: { path: { budgetId, payeeId } },
          body: { operator: rule.operator, text: rule.text, position: index },
        });
        id = again.id;
      },
    });
  }

  function editRule(rule: PayeeRule, change: { operator?: PayeeRuleOperator; text?: string }) {
    const set = (body: { operator: PayeeRuleOperator; text: string }) => async () => {
      await update.mutateAsync({ params: { path: { budgetId, ruleId: rule.id } }, body });
    };
    return run({
      label: "Edit renaming rule",
      redo: set({ operator: change.operator ?? rule.operator, text: change.text ?? rule.text }),
      undo: set({ operator: rule.operator, text: rule.text }),
    });
  }

  return (
    <section
      aria-labelledby="payee-renaming"
      className="dimmed grid gap-2 rounded-lg border bg-background p-4"
    >
      <h3 id="payee-renaming" className="flex items-center gap-1.5 font-semibold text-sm">
        Renaming
        <Settings className="size-3 text-muted-foreground" aria-hidden />
      </h3>
      <p className="text-muted-foreground text-sm">
        Imported payees that match these rules will be renamed.
      </p>
      {rules.map((rule, i) => (
        <SavedRule
          key={rule.id}
          rule={rule}
          disabled={disabled}
          last={!showBlank && i === rules.length - 1}
          onEdit={(change) => editRule(rule, change).catch(() => {})}
          onRemove={() => removeRule(rule, i).catch(() => {})}
          onAdd={() => setBlankRow(true)}
        />
      ))}
      {showBlank && (
        <BlankRule
          // A fresh blank row after each save.
          key={rules.length}
          disabled={disabled}
          canRemove={rules.length > 0}
          onRemove={() => setBlankRow(false)}
          onSave={(operator, text, another) =>
            addRule(operator, text)
              .then(() => setBlankRow(another))
              .catch(() => {})
          }
        />
      )}
    </section>
  );
}

function OperatorSelect({
  value,
  disabled,
  onChange,
}: {
  value: PayeeRuleOperator;
  disabled?: boolean;
  onChange: (value: PayeeRuleOperator) => void;
}) {
  return (
    <NativeSelect
      aria-label="Rule condition"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as PayeeRuleOperator)}
      className="w-28"
    >
      {PAYEE_RULE_OPERATORS.map((op) => (
        <NativeSelectOption key={op} value={op}>
          {PAYEE_RULE_OPERATOR_LABELS[op]}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

function RowButtons({
  onRemove,
  onAdd,
  disabled,
}: {
  onRemove?: () => void;
  onAdd?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex w-16 shrink-0 gap-1">
      {onRemove && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-8"
          aria-label="Remove renaming rule"
          title="Remove renaming rule"
          disabled={disabled}
          onClick={onRemove}
        >
          <Minus />
        </Button>
      )}
      {onAdd && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-8"
          aria-label="Add a renaming rule"
          title="Add a renaming rule"
          disabled={disabled}
          onClick={onAdd}
        >
          <Plus />
        </Button>
      )}
    </div>
  );
}

function SavedRule({
  rule,
  last,
  disabled,
  onEdit,
  onRemove,
  onAdd,
}: {
  rule: PayeeRule;
  last: boolean;
  disabled?: boolean;
  onEdit: (change: { operator?: PayeeRuleOperator; text?: string }) => void;
  onRemove: () => void;
  onAdd: () => void;
}) {
  const [text, setText] = useState(rule.text);
  useEffect(() => setText(rule.text), [rule.text]);

  function commit() {
    if (text === rule.text) return;
    if (text.trim() === "") onRemove();
    else onEdit({ text });
  }

  return (
    <div className="flex items-center gap-2">
      <OperatorSelect
        value={rule.operator}
        disabled={disabled}
        onChange={(operator) => onEdit({ operator })}
      />
      <Input
        aria-label="Rule text"
        value={text}
        disabled={disabled}
        className="h-8 flex-1"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
      />
      <RowButtons disabled={disabled} onRemove={onRemove} onAdd={last ? onAdd : undefined} />
    </div>
  );
}

function BlankRule({
  canRemove,
  disabled,
  onRemove,
  onSave,
}: {
  canRemove: boolean;
  disabled?: boolean;
  onRemove: () => void;
  /** `another`: open a new blank row after saving ("+"), not on Enter. */
  onSave: (operator: PayeeRuleOperator, text: string, another: boolean) => void;
}) {
  const [operator, setOperator] = useState<PayeeRuleOperator>("contains");
  const [text, setText] = useState("");
  // A blank row isn't saved: "+" and Enter do nothing until there's text.
  const save = (another: boolean) => {
    if (text.trim() !== "") onSave(operator, text, another);
  };
  return (
    <div className="flex items-center gap-2">
      <OperatorSelect value={operator} disabled={disabled} onChange={setOperator} />
      <Input
        aria-label="New rule text"
        value={text}
        disabled={disabled}
        className="h-8 flex-1"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save(false);
        }}
      />
      <RowButtons
        disabled={disabled}
        onRemove={canRemove ? onRemove : undefined}
        onAdd={() => save(true)}
      />
    </div>
  );
}
