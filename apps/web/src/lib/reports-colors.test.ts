import { describe, expect, it } from "vitest";
import type { CategoryList } from "./categories";
import type { ReportSum } from "./reports";
import { colorSlots } from "./reports-colors";

const category = (id: string, groupId: string) =>
  ({
    id,
    groupId,
    name: id,
    hidden: false,
  }) as CategoryList["groups"][number]["categories"][number];
const group = (id: string, ids: string[]) => ({
  id,
  name: id,
  hidden: false,
  kind: null,
  categories: ids.map((c) => category(c, id)),
});
const list: CategoryList = {
  readyToAssignCategoryId: "rta",
  uncategorizedCategoryId: "unc",
  groups: [
    group("cards", ["visa"]),
    group("bills", ["rent", "phone", "power"]),
    group("needs", ["food", "car", "doctor", "rainy"]),
    group("wants", ["dining", "fun", "trips", "misc"]),
  ],
};
const spent = (categoryId: string, net: number): ReportSum => ({
  categoryId,
  outflow: String(net),
  inflow: "0",
  net: String(net),
  count: 1,
});

describe("colorSlots", () => {
  const sums = ["rent", "phone", "power", "food", "car", "doctor", "dining", "fun", "trips"].map(
    (id, i) => spent(id, -1000 * (i + 1)),
  );
  const slots = colorSlots(list, sums);

  it("gives the year's eight biggest spenders the eight colours, in plan order", () => {
    // Rent spent least of the nine, so it's the one left out.
    const top = ["phone", "power", "food", "car", "doctor", "dining", "fun", "trips"];
    expect(top.map((id) => slots.categories.get(id))).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("puts the rest after them, in plan order", () => {
    for (const id of ["visa", "rent", "rainy", "misc"]) {
      expect(slots.categories.get(id)).toBeGreaterThanOrEqual(8);
    }
    expect(slots.categories.get("visa")).toBeLessThan(slots.categories.get("rent") ?? 0);
  });

  it("ranks groups by their categories' spending", () => {
    expect(slots.groups.get("bills")).toBe(0);
    expect(slots.groups.get("needs")).toBe(1);
    expect(slots.groups.get("wants")).toBe(2);
    expect(slots.groups.get("cards")).toBeGreaterThanOrEqual(8);
  });

  it("goes by plan order without spending", () => {
    const empty = colorSlots(list, []);
    expect(empty.categories.get("visa")).toBe(8);
    expect(empty.categories.get("rent")).toBe(9);
  });
});
