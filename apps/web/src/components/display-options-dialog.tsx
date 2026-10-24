import { Button } from "@strictbudget/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@strictbudget/ui/components/dialog";
import { Label } from "@strictbudget/ui/components/label";
import { RadioGroup, RadioGroupItem } from "@strictbudget/ui/components/radio-group";
import { type Theme, useTheme } from "@strictbudget/ui/lib/theme";
import { cn } from "@strictbudget/ui/lib/utils";
import { type ReactNode, useEffect, useId, useState } from "react";
import { useDifferentiateWithoutColor, useProgressBarsSetting } from "@/lib/display-options";
import { PILL, STRONG_PILL } from "./move-money";

/** The choices are kept in this browser, not on the account. */
export function DisplayOptionsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { theme, setTheme } = useTheme();
  const [progressBars, setProgressBars] = useProgressBarsSetting();
  const [strong, setStrong] = useDifferentiateWithoutColor();
  const [draft, setDraft] = useState({ theme, progressBars, strong });
  // Each opening starts from what's in effect.
  useEffect(() => {
    if (open) setDraft({ theme, progressBars, strong });
  }, [open]);

  function apply() {
    setTheme(draft.theme);
    setProgressBars(draft.progressBars);
    setStrong(draft.strong);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Display Options</DialogTitle>
          <DialogDescription className="sr-only">
            How the budget looks in this browser.
          </DialogDescription>
        </DialogHeader>
        <Section
          title="Theme"
          value={draft.theme}
          onChange={(theme) => setDraft((d) => ({ ...d, theme: theme as Theme }))}
          columns={3}
          options={[
            { value: "light", label: "Default", preview: <ThemePreview kind="light" /> },
            { value: "dark", label: "Dark", preview: <ThemePreview kind="dark" /> },
            { value: "system", label: "Match System", preview: <ThemePreview kind="system" /> },
          ]}
        />
        <Section
          title="Progress Bars"
          value={draft.progressBars ? "on" : "off"}
          onChange={(v) => setDraft((d) => ({ ...d, progressBars: v === "on" }))}
          columns={2}
          options={[
            { value: "on", label: "On", preview: <BarsPreview bars /> },
            { value: "off", label: "Off", preview: <BarsPreview bars={false} /> },
          ]}
        />
        <Section
          title="Balance Style"
          value={draft.strong ? "strong" : "default"}
          onChange={(v) => setDraft((d) => ({ ...d, strong: v === "strong" }))}
          columns={2}
          options={[
            { value: "default", label: "Default", preview: <PillsPreview strong={false} /> },
            {
              value: "strong",
              label: "Differentiate Without Color",
              preview: <PillsPreview strong />,
            },
          ]}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={apply}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({
  title,
  value,
  onChange,
  options,
  columns,
}: {
  title: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; preview: ReactNode }[];
  columns: 2 | 3;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="grid gap-2">
      <h3 id={id} className="font-medium text-sm">
        {title}
      </h3>
      <RadioGroup
        aria-labelledby={id}
        value={value}
        onValueChange={onChange}
        className={cn("grid gap-2", columns === 3 ? "grid-cols-3" : "grid-cols-2")}
      >
        {options.map((option) => (
          <Label
            key={option.value}
            className="grid cursor-pointer overflow-hidden rounded-lg border font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:ring-1 has-[[data-state=checked]]:ring-primary"
          >
            <span
              aria-hidden
              className="flex h-16 items-center justify-center border-b bg-muted/30"
            >
              {option.preview}
            </span>
            <span className="flex items-center gap-2 p-2 text-sm">
              <RadioGroupItem value={option.value} />
              {option.label}
            </span>
          </Label>
        ))}
      </RadioGroup>
    </section>
  );
}

function ThemePreview({ kind }: { kind: "light" | "dark" | "system" }) {
  const screen = (dark: boolean) => (
    <span className={cn("flex size-full gap-1 p-1.5", dark ? "bg-neutral-900" : "bg-white")}>
      <span className={cn("w-3 rounded-sm", dark ? "bg-neutral-700" : "bg-neutral-300")} />
      <span className="grid flex-1 gap-1">
        {[0, 1, 2].map((i) => (
          <span key={i} className="flex gap-1">
            <span
              className={cn(
                "h-1.5 flex-1 rounded-full",
                dark ? "bg-neutral-700" : "bg-neutral-200",
              )}
            />
            <span
              className={cn("h-1.5 w-3 rounded-full", i === 1 ? "bg-red-300" : "bg-green-300")}
            />
          </span>
        ))}
      </span>
    </span>
  );
  if (kind !== "system") return screen(kind === "dark");
  return (
    <span className="relative size-full">
      {screen(false)}
      <span className="absolute inset-0 [clip-path:polygon(100%_0,100%_100%,0_100%)]">
        {screen(true)}
      </span>
    </span>
  );
}

function BarsPreview({ bars }: { bars: boolean }) {
  return (
    <span className="grid w-3/4 gap-1.5">
      {[0, 1].map((i) => (
        <span key={i} className="grid gap-0.5">
          <span className="h-1.5 w-2/3 rounded-full bg-muted-foreground/30" />
          {bars && (
            <span className="h-1 rounded-full bg-muted-foreground/20">
              <span className={cn("block h-1 rounded-full bg-green-500", i ? "w-1/3" : "w-3/4")} />
            </span>
          )}
        </span>
      ))}
    </span>
  );
}

function PillsPreview({ strong }: { strong: boolean }) {
  const pill = "rounded-full px-2 py-0.5 font-medium text-xs";
  return (
    <span className="flex gap-1">
      <span className={cn(pill, strong ? STRONG_PILL.negative : PILL.negative)}>−$10.00</span>
      <span className={cn(pill, strong ? STRONG_PILL.caution : PILL.caution)}>$10.00</span>
      <span className={cn(pill, PILL.positive)}>$10.00</span>
    </span>
  );
}
