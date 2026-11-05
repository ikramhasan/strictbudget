import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { useShortcutsEnabled } from "./preferences";

export interface UndoCommand {
  /**
   * What it did, as a verb phrase ("delete 2 transactions"), for the Undo/Redo tooltip ("Undo
   * delete 2 transactions") and the toast after it ("Undone · Delete 2 transactions").
   */
  label: string;
  /** It removes something (a delete): its toasts stay up longer, so Undo is easy to reach. */
  destructive?: boolean;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

/** How long a toast offering the way back stays up after something was removed. */
export const DESTRUCTIVE_TOAST_MS = 8000;

interface UndoState {
  /**
   * Records this tab's own version steps: a save's response says each row's version just before it
   * (`previousVersions`) and after it. Undo and redo follow these steps from the version their
   * command left, so a chain of the user's own edits on a row replays, while a partner's change
   * anywhere in between (a step this tab didn't make) leaves the command at an older version, which
   * the API refuses as stale.
   */
  noteSave: (before: Record<string, number>, after: Record<string, number>) => void;
  /** The version to expect for `id`, following this tab's own steps from `from`. */
  expectedVersion: (id: string, from: number) => number;
  undoLabel: string | null;
  redoLabel: string | null;
  busy: boolean;
  record: (command: UndoCommand) => void;
  /**
   * Says what was just done ("Assigned $20.00 to 1 category", "Deleted 2 transactions"), with
   * Undo. A destructive one stays up longer.
   */
  announce: (message: string, options?: { destructive?: boolean }) => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

const UndoContext = createContext<UndoState | null>(null);

/** A failed undo or redo started from a toast's button: the API's message, as a toast. */
function reportError(error: unknown) {
  const message = (error as { error?: { message?: unknown } } | null)?.error?.message;
  toast.error(typeof message === "string" ? message : "Couldn't undo or redo that.");
}

/**
 * The API refused an undo or redo because a partner changed the row since. The command can never
 * apply again, so it leaves the history; the error still reaches the caller, whose toast shows the
 * API's message ("Pat changed this transaction since…").
 */
export function isStaleVersion(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "error" in error &&
    (error as { error?: { code?: unknown } }).error?.code === "STALE_VERSION"
  );
}

/**
 * A budget's undo history deliberately lives only in this provider. It is neither persisted nor
 * sent to the server, so another partner and another browser have independent histories. The
 * commands themselves use normal API mutations, which makes their resulting state authoritative
 * on the server once undo or redo completes.
 */
export function UndoProvider({ children }: { children: ReactNode }) {
  // The history lives in refs, read when an undo or redo actually runs: two quick presses of
  // Cmd+Z undo two commands, never the same one twice. State mirrors it for rendering.
  const past = useRef<UndoCommand[]>([]);
  const future = useRef<UndoCommand[]>([]);
  const [labels, setLabels] = useState<{ undo: string | null; redo: string | null }>({
    undo: null,
    redo: null,
  });
  const [busy, setBusy] = useState(false);
  /** The undo or redo running now; the next one waits for it. */
  const running = useRef<Promise<unknown>>(Promise.resolve());
  const pending = useRef(0);
  /** Per transaction: version → the version this tab's own save took it to. */
  const steps = useRef(new Map<string, Map<number, number>>());

  const sync = useCallback(() => {
    setLabels({
      undo: past.current.at(-1)?.label ?? null,
      redo: future.current.at(-1)?.label ?? null,
    });
  }, []);

  const noteSave = useCallback((before: Record<string, number>, after: Record<string, number>) => {
    for (const [id, to] of Object.entries(after)) {
      const from = before[id];
      if (from === undefined || from === to) continue;
      const rowSteps = steps.current.get(id) ?? new Map<number, number>();
      rowSteps.set(from, to);
      steps.current.set(id, rowSteps);
    }
  }, []);
  const expectedVersion = useCallback((id: string, from: number) => {
    const rowSteps = steps.current.get(id);
    let version = from;
    // Versions only go up, so this ends.
    for (let next = rowSteps?.get(version); next !== undefined && next > version; ) {
      version = next;
      next = rowSteps?.get(version);
    }
    return version;
  }, []);

  /**
   * The toast offering the way back, and the command it acts on. Undo and redo update it in place;
   * a newer command closes it, so its button never reaches a command it doesn't name.
   */
  const shown = useRef<{ id: string; command: UndoCommand } | null>(null);
  const toastCount = useRef(0);

  const record = useCallback(
    (command: UndoCommand) => {
      past.current = [...past.current, command];
      future.current = [];
      if (shown.current) {
        toast.dismiss(shown.current.id);
        shown.current = null;
      }
      sync();
    },
    [sync],
  );

  // The toast's button runs the latest undo or redo, once it's checked to be the one it names.
  const latest = useRef<{ undo: () => Promise<void>; redo: () => Promise<void> } | null>(null);
  /**
   * A toast's Undo or Redo button for `command`: it runs once, and the toast stays up to say what
   * it did ("Undone · …", with the way back) rather than closing under the pointer.
   */
  const toastAction = useCallback((id: string, label: "Undo" | "Redo", command: UndoCommand) => {
    let used = false;
    return {
      label,
      onClick: (event: { preventDefault: () => void }) => {
        event.preventDefault();
        if (used) return;
        used = true;
        if ((label === "Undo" ? past : future).current.at(-1) !== command) {
          toast.dismiss(id);
          return;
        }
        const run = label === "Undo" ? latest.current?.undo() : latest.current?.redo();
        void run?.catch((error: unknown) => {
          toast.dismiss(id);
          reportError(error);
        });
      },
    };
  }, []);
  /** Shows (or updates) the toast for `command`, with its Undo or Redo. */
  const show = useCallback(
    (message: string, command: UndoCommand, label: "Undo" | "Redo", long: boolean) => {
      toastCount.current += 1;
      const id = shown.current?.id ?? `undo-${toastCount.current}`;
      shown.current = { id, command };
      const forget = () => {
        if (shown.current?.id === id) shown.current = null;
      };
      toast(message, {
        id,
        ...(long ? { duration: DESTRUCTIVE_TOAST_MS } : {}),
        action: toastAction(id, label, command),
        onDismiss: forget,
        onAutoClose: forget,
      });
    },
    [toastAction],
  );
  /** Says what just happened, with the way back. */
  const announceStep = useCallback(
    (done: "Undone" | "Redone", command: UndoCommand) => {
      const label = command.label;
      // Redoing a delete removes it again; undoing a delete brings it back.
      const removed = Boolean(command.destructive) && done === "Redone";
      show(
        `${done} · ${label.charAt(0).toUpperCase()}${label.slice(1)}`,
        command,
        done === "Undone" ? "Redo" : "Undo",
        removed,
      );
    },
    [show],
  );

  const announce = useCallback(
    (message: string, options?: { destructive?: boolean }) => {
      const command = past.current.at(-1);
      if (!command) return void toast(message);
      show(message, command, "Undo", Boolean(options?.destructive));
    },
    [show],
  );

  /** Runs one step after any still running, on the command at the top of its stack by then. */
  const step = useCallback(
    (direction: "undo" | "redo") => {
      const from = direction === "undo" ? past : future;
      const to = direction === "undo" ? future : past;
      pending.current += 1;
      setBusy(true);
      const run = running.current.then(async () => {
        const command = from.current.at(-1);
        if (!command) return;
        try {
          await command[direction]();
          from.current = from.current.filter((c) => c !== command);
          to.current = [...to.current, command];
          announceStep(direction === "undo" ? "Undone" : "Redone", command);
        } catch (error) {
          // A partner changed the row since: the command can never apply again.
          if (isStaleVersion(error)) from.current = from.current.filter((c) => c !== command);
          throw error;
        } finally {
          sync();
        }
      });
      running.current = run.catch(() => {});
      return run.finally(() => {
        pending.current -= 1;
        if (pending.current === 0) setBusy(false);
      });
    },
    [announceStep, sync],
  );
  const undo = useCallback(() => step("undo"), [step]);
  const redo = useCallback(() => step("redo"), [step]);
  latest.current = { undo, redo };

  return (
    <UndoContext.Provider
      value={{
        noteSave,
        expectedVersion,
        undoLabel: labels.undo,
        redoLabel: labels.redo,
        busy,
        record,
        announce,
        undo,
        redo,
      }}
    >
      {children}
    </UndoContext.Provider>
  );
}

/** The history, or null outside a budget (a component shown on its own, as in tests). */
export function useOptionalUndo() {
  return useContext(UndoContext);
}

export function useUndo() {
  const value = useContext(UndoContext);
  if (!value) throw new Error("useUndo must be used inside UndoProvider");
  return value;
}

/** Inputs that hold no text: Cmd+Z in one has nothing of its own to undo. */
const NOT_TEXT = new Set([
  "checkbox",
  "radio",
  "button",
  "submit",
  "reset",
  "range",
  "color",
  "file",
]);

/** Browser-native undo keeps priority while the user is typing in an editable control. */
function isEditing(target: EventTarget | null) {
  return (
    (target instanceof HTMLInputElement && !NOT_TEXT.has(target.type)) ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export function useUndoShortcuts(onError: (error: unknown) => void) {
  const history = useUndo();
  const enabled = useShortcutsEnabled();
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditing(event.target) || event.altKey || (!event.metaKey && !event.ctrlKey)) return;
      const undo = event.key.toLowerCase() === "z" && !event.shiftKey;
      const redo =
        (event.key.toLowerCase() === "z" && event.shiftKey) || event.key.toLowerCase() === "y";
      if ((!undo || !history.undoLabel) && (!redo || !history.redoLabel)) return;
      event.preventDefault();
      void (undo ? history.undo() : history.redo()).catch(onError);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [history, onError, enabled]);
}
