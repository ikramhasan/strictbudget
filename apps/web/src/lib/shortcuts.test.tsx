import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { preferencesQueryOptions } from "./preferences";
import { type BoundShortcutId, capLabel, SHORTCUTS, useShortcut } from "./shortcuts";

function withPreferences(keyboardShortcuts: boolean) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(preferencesQueryOptions().queryKey, {
    openLastBudget: true,
    keyboardShortcuts,
  } as never);
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function Bound({
  id,
  onFire,
  allowIn,
}: {
  id: BoundShortcutId;
  onFire: () => void;
  allowIn?: (target: Element) => boolean;
}) {
  useShortcut(id, onFire, { allowIn });
  return (
    <>
      <input aria-label="Field" />
      <input aria-label="Assigned" data-allowed />
      {/* biome-ignore lint/a11y/useSemanticElements: a Radix ToggleGroup item renders this */}
      <button type="button" role="radio" aria-checked="false">
        View tab
      </button>
      <div role="dialog" aria-label="Dialog">
        <button type="button">In dialog</button>
      </div>
    </>
  );
}

function setup(
  id: BoundShortcutId,
  { enabled = true, allowIn }: { enabled?: boolean; allowIn?: (t: Element) => boolean } = {},
) {
  const onFire = vi.fn();
  render(<Bound id={id} onFire={onFire} allowIn={allowIn} />, {
    wrapper: withPreferences(enabled),
  });
  return { onFire, user: userEvent.setup() };
}

describe("useShortcut", () => {
  it("fires the letter and shift shortcuts", async () => {
    const { onFire, user } = setup("snooze");
    await user.keyboard("z");
    expect(onFire).not.toHaveBeenCalled();
    await user.keyboard("{Shift>}Z{/Shift}");
    expect(onFire).toHaveBeenCalledOnce();
  });

  it("matches the typed character for ? and Shift+.", async () => {
    const help = setup("help");
    await help.user.keyboard("?");
    expect(help.onFire).toHaveBeenCalledOnce();
    // A real keyboard holds Shift for it.
    await help.user.keyboard("{Shift>}?{/Shift}");
    expect(help.onFire).toHaveBeenCalledTimes(2);
  });

  it("matches Shift+. as >", async () => {
    const { onFire, user } = setup("sidebar");
    await user.keyboard("{Shift>}>{/Shift}");
    expect(onFire).toHaveBeenCalledOnce();
  });

  it("does nothing with the account's keyboard shortcuts turned off", async () => {
    const { onFire, user } = setup("snooze", { enabled: false });
    await user.keyboard("{Shift>}Z{/Shift}");
    expect(onFire).not.toHaveBeenCalled();
  });

  it("leaves text fields and dialogs alone", async () => {
    const { onFire, user } = setup("categorize");
    await user.click(screen.getByRole("textbox", { name: "Field" }));
    await user.keyboard("k");
    await user.click(screen.getByRole("button", { name: "In dialog" }));
    await user.keyboard("k");
    expect(onFire).not.toHaveBeenCalled();
  });

  it("fires from the fields a shortcut allows, and only those", async () => {
    const { onFire, user } = setup("snooze", { allowIn: (t) => t.hasAttribute("data-allowed") });
    await user.click(screen.getByRole("textbox", { name: "Field" }));
    await user.keyboard("{Shift>}Z{/Shift}");
    // A role-based control (a toggle-group item) is a field too.
    await user.click(screen.getByRole("radio", { name: "View tab" }));
    await user.keyboard("{Shift>}Z{/Shift}");
    expect(onFire).not.toHaveBeenCalled();
    await user.click(screen.getByRole("textbox", { name: "Assigned" }));
    await user.keyboard("{Shift>}Z{/Shift}");
    expect(onFire).toHaveBeenCalledOnce();
  });
});

describe("SHORTCUTS", () => {
  it("lists the dialog in its sections", () => {
    const sections = new Set(Object.values(SHORTCUTS).map((s) => s.section));
    expect([...sections]).toEqual(["Universal", "Plan Actions", "Account Actions", "Date Picker"]);
    expect(Object.keys(SHORTCUTS)).toHaveLength(40);
  });

  it("reads mod as ⌘ on a Mac and ctrl elsewhere", () => {
    expect(capLabel("mod", true)).toBe("⌘");
    expect(capLabel("mod", false)).toBe("ctrl");
    expect(capLabel("Z", true)).toBe("Z");
  });
});
