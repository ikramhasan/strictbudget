import { z } from "zod";

/**
 * Renaming-rule conditions: the imported payee name **is** the text, or **contains** it. There's
 * no "starts with" and no wildcards.
 */
export const PAYEE_RULE_OPERATORS = ["contains", "is"] as const;
export type PayeeRuleOperator = (typeof PAYEE_RULE_OPERATORS)[number];
export const zPayeeRuleOperator = z.enum(PAYEE_RULE_OPERATORS);

/** Manage Payees' labels, in display order (Contains is the default). */
export const PAYEE_RULE_OPERATOR_LABELS: Record<PayeeRuleOperator, string> = {
  contains: "Contains",
  is: "Is",
};

export interface PayeeRuleCondition {
  operator: PayeeRuleOperator;
  text: string;
}

/**
 * Whether an imported payee name meets a rule. Not case-sensitive. The text is compared as stored
 * (as typed, surrounding spaces included). Empty text matches nothing.
 */
export function payeeRuleMatches(rule: PayeeRuleCondition, importedName: string): boolean {
  if (rule.text.length === 0) return false;
  const name = importedName.toLowerCase();
  const text = rule.text.toLowerCase();
  return rule.operator === "is" ? name === text : name.includes(text);
}

/**
 * The rule that renames an imported payee, or undefined when none matches. A payee's rules are
 * OR'ed, and when rules of several payees match, the newest rule wins, so `rules` must be the
 * budget's rules oldest first.
 */
export function matchPayeeRule<R extends PayeeRuleCondition>(
  rules: readonly R[],
  importedName: string,
): R | undefined {
  for (let i = rules.length - 1; i >= 0; i--) {
    const rule = rules[i] as R;
    if (payeeRuleMatches(rule, importedName)) return rule;
  }
  return undefined;
}
