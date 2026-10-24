import { Button } from "@strictbudget/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@strictbudget/ui/components/dialog";
import { Slider } from "@strictbudget/ui/components/slider";
import { Spinner } from "@strictbudget/ui/components/spinner";
import { cn } from "@strictbudget/ui/lib/utils";
import { ImagePlus, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { toast } from "sonner";
import { cropToBlob } from "@/lib/pictures";

/** "circle": a profile picture (cropped square, shown round). "square": an account logo. */
export type PictureShape = "circle" | "square";

/**
 * Crops a picked image to a square: a circular highlight for a profile picture (it shows as a
 * circle), a plain square for a logo. Drag to move, scroll, pinch or the slider to zoom.
 */
export function PictureCropDialog({
  src,
  shape,
  size,
  title,
  onCancel,
  onCrop,
}: {
  /** The picked image (an object URL); null closes the dialog. */
  src: string | null;
  shape: PictureShape;
  /** The square's side in px, as sent. */
  size: number;
  title: string;
  onCancel: () => void;
  onCrop: (blob: Blob) => void | Promise<void>;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);
  // A new image starts centred and unzoomed.
  const [shown, setShown] = useState(src);
  if (shown !== src) {
    setShown(src);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setArea(null);
  }

  async function save() {
    if (!src || !area) return;
    setSaving(true);
    try {
      await onCrop(await cropToBlob(src, area, size));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't crop the picture.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={src !== null} onOpenChange={(open) => !open && !saving && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Drag to move the picture; zoom to fit.</DialogDescription>
        </DialogHeader>
        <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-muted">
          {src && (
            <Cropper
              image={src}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape={shape === "circle" ? "round" : "rect"}
              showGrid={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(_, pixels) => setArea(pixels)}
            />
          )}
        </div>
        <div className="flex items-center gap-3 text-muted-foreground">
          <ZoomOut className="size-4 shrink-0" aria-hidden />
          <Slider
            aria-label="Zoom"
            min={1}
            max={3}
            step={0.01}
            value={[zoom]}
            onValueChange={([value]) => setZoom(value ?? 1)}
          />
          <ZoomIn className="size-4 shrink-0" aria-hidden />
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={saving || !area} onClick={() => void save()}>
            {saving && <Spinner />}
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PicturePreview({
  src,
  shape,
  fallback,
  className,
}: {
  src: string | undefined;
  shape: PictureShape;
  fallback: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden bg-muted text-muted-foreground",
        shape === "circle" ? "rounded-full" : "rounded-md",
        className,
      )}
    >
      {src ? <img src={src} alt="" className="size-full object-cover" /> : fallback}
    </span>
  );
}

/**
 * `onPick` gets the cropped square (it may upload it or keep it for later, as a new account's logo
 * does).
 */
export function PictureField({
  shape,
  size,
  src,
  fallback,
  label,
  cropTitle,
  onPick,
  onRemove,
  disabled = false,
}: {
  shape: PictureShape;
  size: number;
  src: string | undefined;
  /** Shown in the preview without a picture (an initial, an icon). */
  fallback: ReactNode;
  /** "Profile picture", "Logo": names the buttons for screen readers. */
  label: string;
  cropTitle: string;
  onPick: (blob: Blob) => Promise<void> | void;
  onRemove?: () => Promise<void> | void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The picked file's object URL lives until another is picked or the field goes.
  useEffect(() => () => (picked ? URL.revokeObjectURL(picked) : undefined), [picked]);

  async function run(action: () => Promise<void> | void) {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-4">
      <PicturePreview src={src} shape={shape} fallback={fallback} className="size-16 text-xl" />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || busy}
          aria-label={src ? `Change ${label.toLowerCase()}` : `Upload ${label.toLowerCase()}`}
          onClick={() => input.current?.click()}
        >
          {busy ? <Spinner /> : <ImagePlus />}
          {src ? "Change" : "Upload"}
        </Button>
        {src && onRemove && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive"
            disabled={disabled || busy}
            aria-label={`Remove ${label.toLowerCase()}`}
            onClick={() => void run(onRemove)}
          >
            <Trash2 /> Remove
          </Button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) setPicked(URL.createObjectURL(file));
        }}
      />
      <PictureCropDialog
        src={picked}
        shape={shape}
        size={size}
        title={cropTitle}
        onCancel={() => setPicked(null)}
        onCrop={async (blob) => {
          await run(() => onPick(blob));
          setPicked(null);
        }}
      />
    </div>
  );
}
