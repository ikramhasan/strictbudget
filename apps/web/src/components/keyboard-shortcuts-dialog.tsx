import { Button } from "@strictbudget/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@strictbudget/ui/components/dialog";
import { Kbd, KbdGroup } from "@strictbudget/ui/components/kbd";
import { capLabel, SHORTCUT_SECTIONS, SHORTCUTS, type ShortcutDef } from "@/lib/shortcuts";

const BY_SECTION = SHORTCUT_SECTIONS.map((section) => ({
  section,
  shortcuts: (Object.values(SHORTCUTS) as ShortcutDef[]).filter((s) => s.section === section),
}));

export function KeyboardShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90svh] flex-col gap-0 p-0 sm:max-w-3xl">
        <DialogHeader className="border-b p-4">
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
          <DialogDescription className="sr-only">
            The keys for the plan, accounts, transactions and dates.
          </DialogDescription>
        </DialogHeader>
        {/* Focusable, so keyboard users can scroll the list (it has no controls of its own). */}
        <section
          aria-label="Shortcuts"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region must take focus (WCAG 2.1.1)
          tabIndex={0}
          className="min-h-0 flex-1 overflow-y-auto focus-visible:outline-2 focus-visible:outline-ring"
        >
          <div className="grid gap-6 p-4">
            {BY_SECTION.map(({ section, shortcuts }) => (
              <section key={section} aria-labelledby={`shortcuts-${section}`}>
                <h3 id={`shortcuts-${section}`} className="mb-2 font-semibold text-base">
                  {section}
                </h3>
                <dl className="gap-x-6 md:columns-2">
                  {shortcuts.map((shortcut) => (
                    <div
                      key={shortcut.label}
                      className="flex break-inside-avoid items-center justify-between gap-3 border-b py-2 text-sm"
                    >
                      <dt>{shortcut.label}</dt>
                      <dd>
                        <Caps caps={shortcut.caps} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </section>
        <DialogFooter className="m-0 border-t px-4 py-3">
          <DialogClose asChild>
            <Button>OK</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Caps({ caps }: { caps: readonly string[] }) {
  return (
    <KbdGroup>
      {caps.map((cap, i) =>
        cap === "then" ? (
          <span key={i} className="text-muted-foreground text-xs">
            then
          </span>
        ) : (
          <Kbd key={i}>{capLabel(cap)}</Kbd>
        ),
      )}
    </KbdGroup>
  );
}
