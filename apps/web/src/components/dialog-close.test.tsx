import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@strictbudget/ui/components/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@strictbudget/ui/components/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@strictbudget/ui/components/sheet";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

/**
 * Radix locks the page until a closing dialog's exit animation ends; jsdom runs no animations, so
 * these start the exit by hand: the panel's state turns `closed` and its animation starts.
 */
function startClosing(panel: HTMLElement) {
  panel.setAttribute("data-state", "closed");
  // React listens for the prefixed event where jsdom has no AnimationEvent.
  fireEvent(panel, new Event("webkitAnimationStart", { bubbles: true }));
}

const kinds = {
  dialog: () => (
    <Dialog open>
      <DialogContent>
        <DialogTitle>Shortcuts</DialogTitle>
        <DialogDescription>Keys</DialogDescription>
      </DialogContent>
    </Dialog>
  ),
  "alert dialog": () => (
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogTitle>Delete?</AlertDialogTitle>
        <AlertDialogDescription>Gone for good</AlertDialogDescription>
      </AlertDialogContent>
    </AlertDialog>
  ),
  sheet: () => (
    <Sheet open>
      <SheetContent>
        <SheetTitle>Filters</SheetTitle>
        <SheetDescription>Narrow the list</SheetDescription>
      </SheetContent>
    </Sheet>
  ),
};

describe("closing a dialog", () => {
  it.each(Object.entries(kinds))("releases the page as a %s starts to close", (_, Kind) => {
    render(<Kind />);
    expect(document.body.style.pointerEvents).toBe("none");
    const panel = document.querySelector<HTMLElement>("[role=dialog], [role=alertdialog]");
    if (!panel) throw new Error("no dialog");
    startClosing(panel);
    expect(document.body.style.pointerEvents).toBe("");
  });

  it("keeps the page locked while another dialog stays open beneath it", () => {
    render(
      <>
        {kinds.sheet()}
        {kinds.dialog()}
      </>,
    );
    const shortcuts = screen.getByText("Shortcuts").closest<HTMLElement>("[role=dialog]");
    if (!shortcuts) throw new Error("no dialog");
    startClosing(shortcuts);
    expect(document.body.style.pointerEvents).toBe("none");
  });
});
