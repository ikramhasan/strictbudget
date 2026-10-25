import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useCollapsedSplits } from "./collapsed-splits";

describe("collapsed splits", () => {
  beforeEach(() => localStorage.clear());

  it("remembers folded splits by transaction id, and forgets one unfolded", () => {
    const { result } = renderHook(() => useCollapsedSplits());
    expect(result.current[0]).toEqual({});
    act(() => result.current[1]("t1"));
    act(() => result.current[1]("t2"));
    expect(result.current[0]).toEqual({ t1: true, t2: true });
    act(() => result.current[1]("t1"));
    expect(result.current[0]).toEqual({ t2: true });
    expect(renderHook(() => useCollapsedSplits()).result.current[0]).toEqual({ t2: true });
  });
});
