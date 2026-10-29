import { newId, sql } from "@strictbudget/db";
import { category, categoryGroup, categoryTarget } from "@strictbudget/db/schema";
import { type CurrencyCode, currencyExponent, looksLikeSavings } from "@strictbudget/engine";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { CATEGORY_TEMPLATE_DATA } from "./category-template-data";
import { templateCategoryNote } from "./category-template-notes";
import { AppError } from "./errors";
import type { Db } from "./ledger";
import { writeOrder } from "./ordering";

/**
 * A ready-made category set from the template gallery. Amounts are whole units of the budget's
 * currency, so $1,000.00 in a dollar budget is ¥1,000 in a yen one.
 */
export interface CategoryTemplate {
  /** The template's slug in the gallery. */
  id: string;
  name: string;
  description: string;
  groups: ReadonlyArray<{
    name: string;
    /** `amount` 0n: no example amount, so no target. */
    categories: ReadonlyArray<{ name: string; amount: bigint }>;
  }>;
}

export const CATEGORY_TEMPLATES = CATEGORY_TEMPLATE_DATA;

/** A template category's id within its template: "<group index>.<category index>". */
export const templateCategoryId = (groupIndex: number, categoryIndex: number) =>
  `${groupIndex}.${categoryIndex}`;

export function findCategoryTemplate(templateId: string) {
  const template = CATEGORY_TEMPLATES.find((t) => t.id === templateId);
  if (!template) throw new AppError(404, "NOT_FOUND", "No such category template");
  return template;
}

/** A template amount (whole units) in the currency's minor units. */
export const templateAmount = (amount: bigint, currency: CurrencyCode) =>
  amount * 10n ** BigInt(currencyExponent(currency));

const key = (name: string) => name.trim().toLowerCase();

/**
 * Import Category Template: adds the picked categories without changing anything already there.
 * - A group the budget already has (by name) takes the template's categories it's missing, at its
 *   top in the template's order; the others become new groups at the bottom, in order.
 * - A category the group already has (by name, ignoring case) is skipped and keeps its target. One
 *   with the same name in another group doesn't count: the template's is added too.
 * - Each new category with an example amount gets a "Have a balance of" target for it, due
 *   eventually, from `month` on. Nothing is assigned.
 * - A new category gets the template's note for it, if there is one (see
 *   `category-template-notes.ts`; every "About This Template" has one).
 *
 * Group names match ignoring case. Returns how many categories were added.
 */
export async function importCategoryTemplate(
  tx: Db,
  opts: {
    budgetId: string;
    currency: CurrencyCode;
    template: CategoryTemplate;
    categoryIds: readonly string[];
    month: string;
  },
): Promise<number> {
  const { budgetId, currency, template, month } = opts;
  const picked = new Set(opts.categoryIds);
  const known = new Set(
    template.groups.flatMap((g, gi) => g.categories.map((_, ci) => templateCategoryId(gi, ci))),
  );
  const unknown = [...picked].filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new AppError(400, "BAD_REQUEST", `Not in this template: ${unknown.join(", ")}`);
  }

  const groups = await tx
    .select()
    .from(categoryGroup)
    .where(
      and(
        eq(categoryGroup.budgetId, budgetId),
        eq(categoryGroup.internal, false),
        isNull(categoryGroup.kind),
      ),
    )
    .orderBy(asc(categoryGroup.sortOrder), asc(categoryGroup.id))
    .for("update");
  const existingCategories =
    groups.length === 0
      ? []
      : await tx
          .select({ id: category.id, groupId: category.groupId, name: category.name })
          .from(category)
          .where(
            inArray(
              category.groupId,
              groups.map((g) => g.id),
            ),
          )
          .orderBy(asc(category.sortOrder), asc(category.id));
  const [maxRow] = await tx
    .select({ value: sql<number | null>`max(${categoryGroup.sortOrder})` })
    .from(categoryGroup)
    .where(eq(categoryGroup.budgetId, budgetId));
  let nextGroupOrder = (maxRow?.value ?? -1) + 1;

  let added = 0;
  const targets: (typeof categoryTarget.$inferInsert)[] = [];
  for (const [gi, g] of template.groups.entries()) {
    const wanted = g.categories
      .map((c, ci) => ({ ...c, id: templateCategoryId(gi, ci) }))
      .filter((c) => picked.has(c.id));
    if (wanted.length === 0) continue;

    const group = groups.find((x) => key(x.name) === key(g.name));
    const inGroup = group ? existingCategories.filter((c) => c.groupId === group.id) : [];
    const have = new Set(inGroup.map((c) => key(c.name)));
    const missing = wanted.filter((c) => !have.has(key(c.name)));
    if (missing.length === 0) continue;

    let groupId = group?.id;
    if (!groupId) {
      groupId = newId();
      await tx
        .insert(categoryGroup)
        .values({ id: groupId, budgetId, name: g.name, sortOrder: nextGroupOrder++ });
    }
    const rows = missing.map((c, i) => ({
      id: newId(),
      budgetId,
      groupId,
      name: c.name,
      sortOrder: i,
      note: templateCategoryNote(template.id, c.name) ?? "",
      // A savings group's categories are savings, as is one named like savings anywhere.
      savings: looksLikeSavings(g.name) || looksLikeSavings(c.name),
      amount: c.amount,
    }));
    await tx.insert(category).values(rows.map(({ amount: _, ...row }) => row));
    // New ones go at the top of an existing group.
    if (group) {
      await writeOrder(tx, category, [...rows.map((r) => r.id), ...inGroup.map((c) => c.id)]);
    }
    for (const r of rows) {
      if (r.amount <= 0n) continue;
      targets.push({
        id: newId(),
        budgetId,
        categoryId: r.id,
        cadence: "custom",
        behavior: "balance",
        amount: templateAmount(r.amount, currency),
        currency,
        dueDay: null,
        dueDate: null,
        repeatEvery: null,
        repeatUnit: null,
        startMonth: `${month}-01`,
        startDay: null,
      });
    }
    added += rows.length;
  }
  if (targets.length > 0) await tx.insert(categoryTarget).values(targets);
  return added;
}
