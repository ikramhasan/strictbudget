import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useExpandedSplits } from "./expanded-splits";

describe("expanded splits", () => {
  beforeEach(() => localStorage.clear());

  it("starts folded, remembers expanded splits by transaction id, and forgets one folded again", () => {
    const { result } = renderHook(() => useExpandedSplits());
    expect(result.current[0]).toEqual({});
    act(() => result.current[1]("t1"));
    act(() => result.current[1]("t2"));
    expect(result.current[0]).toEqual({ t1: true, t2: true });
    act(() => result.current[1]("t1"));
    expect(result.current[0]).toEqual({ t2: true });
    expect(renderHook(() => useExpandedSplits()).result.current[0]).toEqual({ t2: true });
  });
});
