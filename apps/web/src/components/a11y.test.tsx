import { ThemeProvider } from "@strictbudget/ui/lib/theme";
import { render } from "@testing-library/react";
import { describe, it } from "vitest";
import { expectAccessible } from "@/test/axe";
import { DisplayOptionsDialog } from "./display-options-dialog";
import { KeyboardShortcutsDialog } from "./keyboard-shortcuts-dialog";

describe("axe on strictbudget's dialogs", () => {
  it("finds nothing in the Keyboard Shortcuts dialog", async () => {
    render(<KeyboardShortcutsDialog open onOpenChange={() => {}} />);
    await expectAccessible(document.body);
  });

  it("finds nothing in Display Options", async () => {
    render(
      <ThemeProvider>
        <DisplayOptionsDialog open onOpenChange={() => {}} />
      </ThemeProvider>,
    );
    await expectAccessible(document.body);
  });
});
