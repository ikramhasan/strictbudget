import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

type Action = { label: string; onClick: (event: { preventDefault: () => void }) => void };
const shown = vi.hoisted(() => [] as { id: string; action: Action }[]);
const dismissed = vi.hoisted(() => [] as string[]);
vi.mock("sonner", () => ({
  toast: Object.assign(
    (_message: string, options: { id: string; action: Action }) => {
      shown.push({ id: options.id, action: options.action });
    },
    {
      dismiss: (id: string) => dismissed.push(id),
      error: vi.fn(),
    },
  ),
}));

const { UndoProvider, useUndo } = await import("./undo");

const wrapper = ({ children }: { children: ReactNode }) => <UndoProvider>{children}</UndoProvider>;
const click = (action: Action) => action.onClick({ preventDefault: () => {} });

describe("the undo toast", () => {
  it("undoes the command it names, and closes once a newer one is recorded", async () => {
    const remove = { label: "delete 2 transactions", undo: vi.fn(), redo: vi.fn() };
    const toggle = { label: "clear transaction", undo: vi.fn(), redo: vi.fn() };
    const { result } = renderHook(useUndo, { wrapper });
    act(() => {
      result.current.record(remove);
      result.current.announce("Deleted 2 transactions", { destructive: true });
    });
    const toast = shown.at(-1);
    if (!toast) throw new Error("no toast");
    // A change with no toast of its own: the delete's toast goes, and its Undo does nothing.
    act(() => result.current.record(toggle));
    expect(dismissed).toContain(toast.id);
    await act(async () => click(toast.action));
    expect(toggle.undo).not.toHaveBeenCalled();
    expect(remove.undo).not.toHaveBeenCalled();
  });

  it("runs Undo, then Redo from the same toast", async () => {
    const edit = { label: "edit memo", undo: vi.fn(), redo: vi.fn() };
    const { result } = renderHook(useUndo, { wrapper });
    act(() => {
      result.current.record(edit);
      result.current.announce("Memo saved");
    });
    const first = shown.at(-1);
    if (!first) throw new Error("no toast");
    await act(async () => click(first.action));
    expect(edit.undo).toHaveBeenCalledOnce();
    const undone = shown.at(-1);
    expect(undone?.id).toBe(first.id);
    expect(undone?.action.label).toBe("Redo");
    if (!undone) throw new Error("no toast");
    await act(async () => click(undone.action));
    expect(edit.redo).toHaveBeenCalledOnce();
  });
});
