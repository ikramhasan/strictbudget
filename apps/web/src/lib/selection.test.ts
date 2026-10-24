import { describe, expect, it } from "vitest";
import {
  isEmpty,
  isSelected,
  NOTHING,
  rangeTo,
  selectionBody,
  setSelected,
  stepSelection,
} from "./selection";

describe("register selection", () => {
  it("ticks rows one by one", () => {
    const s = setSelected(NOTHING, ["a", "b"], true);
    expect(isSelected(s, "a")).toBe(true);
    expect(isSelected(s, "c")).toBe(false);
    expect(isEmpty(setSelected(s, ["a", "b"], false))).toBe(true);
    expect(selectionBody(s, { q: "x" })).toEqual({ ids: ["a", "b"] });
  });

  it("selects all matching, including rows not loaded, minus unticked ones", () => {
    const all = setSelected({ mode: "all", except: new Set() }, ["b"], false);
    expect(isSelected(all, "not-loaded-yet")).toBe(true);
    expect(isSelected(all, "b")).toBe(false);
    expect(selectionBody(all, { q: "x" })).toEqual({ filter: { q: "x" }, exclude: ["b"] });
  });

  it("selects a shift-click range either way", () => {
    const order = ["a", "b", "c", "d"];
    expect(rangeTo(order, "b", "d")).toEqual(["b", "c", "d"]);
    expect(rangeTo(order, "d", "b")).toEqual(["b", "c", "d"]);
    expect(rangeTo(order, null, "c")).toEqual(["c"]);
    expect(rangeTo(order, "gone", "c")).toEqual(["c"]);
  });
});

describe("stepSelection (Up/Down)", () => {
  const order = ["a", "b", "c", "d"];
  const none = { anchor: null, head: null };
  const step = (
    selected: string[],
    direction: 1 | -1,
    opts: { extend?: boolean; several?: "anchor" | "none" } = {},
    cursor = none as { anchor: string | null; head: string | null },
  ) => stepSelection(order, new Set(selected), cursor, direction, { several: "anchor", ...opts });

  it("selects the first row on Down and the last on Up when nothing is selected", () => {
    expect(step([], 1)?.ids).toEqual(["a"]);
    expect(step([], -1)?.ids).toEqual(["d"]);
  });

  it("moves a single selection and wraps at both ends", () => {
    expect(step(["b"], 1)?.ids).toEqual(["c"]);
    expect(step(["d"], 1)?.ids).toEqual(["a"]);
    expect(step(["a"], -1)?.ids).toEqual(["d"]);
  });

  it("moves on from the anchor with several selected in the register, not at all in the plan", () => {
    const cursor = { anchor: "b", head: "d" };
    expect(step(["b", "c", "d"], 1, {}, cursor)?.ids).toEqual(["c"]);
    expect(step(["b", "c", "d"], 1, { several: "none" }, cursor)).toBeNull();
  });

  it("grows and shrinks a Shift range from the anchor, stopping at the ends", () => {
    const grown = step(["b"], 1, { extend: true });
    expect(grown?.ids).toEqual(["b", "c"]);
    const more = step(grown?.ids ?? [], 1, { extend: true }, grown?.cursor);
    expect(more?.ids).toEqual(["b", "c", "d"]);
    expect(step(more?.ids ?? [], 1, { extend: true }, more?.cursor)).toBeNull();
    const back = step(more?.ids ?? [], -1, { extend: true }, more?.cursor);
    expect(back?.ids).toEqual(["b", "c"]);
    const above = step(["b"], -1, { extend: true });
    expect(above?.ids).toEqual(["a", "b"]);
  });

  it("ignores selected ids that aren't in the list", () => {
    expect(step(["gone"], 1)?.ids).toEqual(["a"]);
  });
});
