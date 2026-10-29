import { describe, expect, it } from "vitest";
import {
  type CategoryList,
  hiddenItems,
  locateCategory,
  nextId,
  visibleLayout,
} from "./categories";

const c = (id: string, groupId: string, hidden = false) => ({
  id,
  groupId,
  name: id,
  note: "",
  hidden,
  linkedAccountId: null,
  hasTransactions: false,
  transactionCount: 0,
  hasAssignedMoney: false,
  savings: false,
  target: null,
});

const list: CategoryList = {
  readyToAssignCategoryId: "rta",
  uncategorizedCategoryId: "uncat",
  groups: [
    {
      id: "g1",
      name: "Bills",
      hidden: false,
      kind: null,
      categories: [c("rent", "g1"), c("old", "g1", true)],
    },
    { id: "g2", name: "Old stuff", hidden: true, kind: null, categories: [c("x", "g2")] },
    { id: "g3", name: "Fun", hidden: false, kind: null, categories: [] },
  ],
};

describe("category layout helpers", () => {
  it("shows only visible groups and categories", () => {
    expect(visibleLayout(list)).toEqual({
      groupOrder: ["g1", "g3"],
      items: { g1: ["rent"], g3: [] },
    });
  });

  it("collects hidden groups and hidden categories of visible groups", () => {
    const hidden = hiddenItems(list);
    expect(hidden.groups.map((g) => g.id)).toEqual(["g2"]);
    expect(hidden.categories).toEqual([expect.objectContaining({ id: "old", groupName: "Bills" })]);
  });

  it("finds the move-before target", () => {
    expect(nextId(["a", "b", "c"], "a")).toBe("b");
    expect(nextId(["a", "b", "c"], "c")).toBeNull();
    expect(nextId(["a"], "zzz")).toBeNull();
  });

  it("locates a category after a drag", () => {
    expect(locateCategory({ g1: ["a", "b"], g3: ["c"] }, "a")).toEqual({
      groupId: "g1",
      beforeCategoryId: "b",
    });
    expect(locateCategory({ g1: ["b"], g3: ["c", "a"] }, "a")).toEqual({
      groupId: "g3",
      beforeCategoryId: null,
    });
    expect(locateCategory({ g1: [] }, "a")).toBeNull();
  });
});
