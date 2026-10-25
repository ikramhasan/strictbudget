import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { preferencesQueryOptions } from "./preferences";
import { UndoProvider, useUndo, useUndoShortcuts } from "./undo";

const wrapper = ({ children }: { children: ReactNode }) => <UndoProvider>{children}</UndoProvider>;

describe("UndoProvider", () => {
  it("runs commands in order and moves them between undo and redo", async () => {
    const first = { label: "first", undo: vi.fn(), redo: vi.fn() };
    const second = { label: "second", undo: vi.fn(), redo: vi.fn() };
    const { result } = renderHook(useUndo, { wrapper });

    act(() => {
      result.current.record(first);
      result.current.record(second);
    });
    expect(result.current.undoLabel).toBe("second");

    await act(() => result.current.undo());
    expect(second.undo).toHaveBeenCalledOnce();
    expect(result.current.undoLabel).toBe("first");
    expect(result.current.redoLabel).toBe("second");

    await act(() => result.current.redo());
    expect(second.redo).toHaveBeenCalledOnce();
    expect(result.current.undoLabel).toBe("second");
    expect(result.current.redoLabel).toBeNull();
  });

  it("clears redo when a new edit is recorded", async () => {
    const { result } = renderHook(useUndo, { wrapper });
    act(() => result.current.record({ label: "old", undo: vi.fn(), redo: vi.fn() }));
    await act(() => result.current.undo());
    act(() => result.current.record({ label: "new", undo: vi.fn(), redo: vi.fn() }));
    expect(result.current.undoLabel).toBe("new");
    expect(result.current.redoLabel).toBeNull();
  });

  it("keeps a failed command available to retry", async () => {
    const failed = {
      label: "failed",
      undo: vi.fn().mockRejectedValue(new Error("no")),
      redo: vi.fn(),
    };
    const { result } = renderHook(useUndo, { wrapper });
    act(() => result.current.record(failed));
    await expect(act(() => result.current.undo())).rejects.toThrow("no");
    expect(result.current.undoLabel).toBe("failed");
    expect(result.current.redoLabel).toBeNull();
  });

  it("drops an undo a partner's later change made stale", async () => {
    const stale = {
      error: { code: "STALE_VERSION", message: "Pat changed this transaction since" },
    };
    const older = { label: "older", undo: vi.fn(), redo: vi.fn() };
    const command = { label: "edit", undo: vi.fn().mockRejectedValue(stale), redo: vi.fn() };
    const { result } = renderHook(useUndo, { wrapper });
    act(() => {
      result.current.record(older);
      result.current.record(command);
    });
    await expect(act(() => result.current.undo())).rejects.toBe(stale);
    await act(async () => {});
    // It can't apply again, so the next undo is the one before it, and there's nothing to redo.
    expect(result.current.undoLabel).toBe("older");
    expect(result.current.redoLabel).toBeNull();
  });

  it("follows only this tab's own version steps", () => {
    const { result } = renderHook(useUndo, { wrapper });
    // Own chain: edit memo (1 → 2), toggle cleared (2 → 3), undo the toggle (3 → 4). The memo
    // edit's undo, which left the row at 2, now expects 4.
    result.current.noteSave({ t1: 1 }, { t1: 2 });
    result.current.noteSave({ t1: 2 }, { t1: 3 });
    result.current.noteSave({ t1: 3 }, { t1: 4 });
    expect(result.current.expectedVersion("t1", 2)).toBe(4);

    // A partner's change in between (2 → 3 wasn't ours), then two own steps on top of it:
    // the memo edit's undo still expects 2, which the API refuses as stale.
    result.current.noteSave({ t2: 1 }, { t2: 2 });
    result.current.noteSave({ t2: 3 }, { t2: 4 });
    result.current.noteSave({ t2: 4 }, { t2: 5 });
    expect(result.current.expectedVersion("t2", 2)).toBe(2);
    expect(result.current.expectedVersion("t2", 4)).toBe(5);

    // Saving one side of a transfer steps the other side too.
    result.current.noteSave({ a: 1, b: 7 }, { a: 2, b: 8 });
    expect(result.current.expectedVersion("b", 7)).toBe(8);
  });

  it("answers Cmd/Ctrl+Z only while keyboard shortcuts are on", async () => {
    for (const keyboardShortcuts of [true, false]) {
      const queryClient = new QueryClient();
      queryClient.setQueryData(preferencesQueryOptions().queryKey, {
        openLastBudget: true,
        keyboardShortcuts,
      });
      const command = { label: "edit", undo: vi.fn(), redo: vi.fn() };
      const { result } = renderHook(
        () => {
          useUndoShortcuts(() => {});
          return useUndo();
        },
        {
          wrapper: ({ children }) => (
            <QueryClientProvider client={queryClient}>
              <UndoProvider>{children}</UndoProvider>
            </QueryClientProvider>
          ),
        },
      );
      act(() => result.current.record(command));
      await act(async () => {
        fireEvent.keyDown(window, { key: "z", ctrlKey: true });
      });
      expect(command.undo).toHaveBeenCalledTimes(keyboardShortcuts ? 1 : 0);
    }
  });
});
