import { Button } from "@strictbudget/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@strictbudget/ui/components/dialog";
import { Label } from "@strictbudget/ui/components/label";
import { Switch } from "@strictbudget/ui/components/switch";
import { cn } from "@strictbudget/ui/lib/utils";
import { domToPng } from "modern-screenshot";
import { type ReactNode, useCallback, useRef, useState } from "react";
import { toast } from "sonner";

/**
 * Each card is laid out at a fixed size in CSS pixels, so its content fits the same way whatever
 * room the preview has, then exported at `out` pixels wide.
 */
const FORMATS = [
  { id: "portrait", label: "Portrait (4:5)", width: 400, height: 500, out: 1080 },
  { id: "story", label: "Vertical Story (9:16)", width: 360, height: 640, out: 1080 },
  { id: "landscape", label: "Landscape (16:9)", width: 640, height: 360, out: 1920 },
  { id: "square", label: "Square (1:1)", width: 400, height: 400, out: 1080 },
] as const;
type Format = (typeof FORMATS)[number]["id"];

export function ShareImageDialog({
  open,
  onOpenChange,
  tagline,
  fileName,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tagline: string;
  /** The picture's name, without ".png". */
  fileName: string;
  /** `layout`: "row" on a wide card (figures beside the chart), "column" otherwise. */
  children: (options: { showAmounts: boolean; layout: "row" | "column" }) => ReactNode;
}) {
  const [format, setFormat] = useState<Format>("portrait");
  const [showTagline, setShowTagline] = useState(true);
  const [showAmounts, setShowAmounts] = useState(true);
  const [busy, setBusy] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const chosen = FORMATS.find((f) => f.id === format) ?? FORMATS[0];
  const layout = chosen.width > chosen.height ? "row" : "column";
  // The preview shows the card scaled down to fit its frame; the download is drawn unscaled.
  const [frame, setFrame] = useState<{ width: number; height: number } | null>(null);
  const frameRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setFrame({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const scale = frame ? Math.min(frame.width / chosen.width, frame.height / chosen.height, 1) : 0.5;

  async function download() {
    if (!card.current) return;
    setBusy(true);
    try {
      const url = await domToPng(card.current, {
        width: chosen.width,
        height: chosen.height,
        scale: chosen.out / chosen.width,
      });
      const link = document.createElement("a");
      link.href = url;
      link.download = `${fileName}.png`;
      link.click();
    } catch {
      toast.error("Couldn't make the picture.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[95vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Download and Share</DialogTitle>
        </DialogHeader>
        <div className="grid gap-6 md:grid-cols-[13rem_minmax(0,1fr)]">
          <div className="grid content-start gap-3">
            <p className="font-semibold text-sm">Format</p>
            <div className="grid gap-2" role="radiogroup" aria-label="Format">
              {FORMATS.map((f) => (
                // biome-ignore lint/a11y/useSemanticElements: a styled button group
                <button
                  key={f.id}
                  type="button"
                  role="radio"
                  aria-checked={format === f.id}
                  onClick={() => setFormat(f.id)}
                  className={cn(
                    "rounded-md border px-3 py-2 text-left text-sm",
                    format === f.id ? "border-primary bg-primary/10" : "bg-muted/50 hover:bg-muted",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="grid gap-3 border-t pt-3">
              <div className="flex items-center gap-2">
                <Switch id="share-tagline" checked={showTagline} onCheckedChange={setShowTagline} />
                <Label htmlFor="share-tagline">Show Tagline</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="share-amounts" checked={showAmounts} onCheckedChange={setShowAmounts} />
                <Label htmlFor="share-amounts">Show Amounts</Label>
              </div>
            </div>
          </div>
          <div className="grid content-start gap-2">
            <p className="font-semibold text-sm">Preview</p>
            <div
              ref={frameRef}
              className="flex h-[22.5rem] items-center justify-center rounded-lg bg-muted/60 p-4"
            >
              <div style={{ width: chosen.width * scale, height: chosen.height * scale }}>
                <div
                  style={{
                    width: chosen.width,
                    height: chosen.height,
                    transform: `scale(${scale})`,
                    transformOrigin: "top left",
                  }}
                >
                  <div
                    ref={card}
                    style={{ width: chosen.width, height: chosen.height }}
                    className="flex flex-col gap-3 overflow-hidden bg-primary p-4 text-primary-foreground"
                  >
                    {showTagline && (
                      <p className="text-balance text-center font-semibold text-lg">{tagline}</p>
                    )}
                    <div
                      className={cn(
                        "flex min-h-0 flex-1 gap-3 rounded-lg bg-background p-4 text-foreground",
                        layout === "row" ? "flex-row" : "flex-col",
                      )}
                    >
                      {children({ showAmounts, layout })}
                    </div>
                    <p className="text-center font-bold text-lg tracking-tight">strictbudget</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={download} disabled={busy}>
            Download Image
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
