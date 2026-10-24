import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useShortcutsEnabled } from "./preferences";

export interface UndoCommand {
  /** Short description shown in the Undo/Redo button tooltip. */
  label: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

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
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

const UndoContext = createContext<UndoState | null>(null);

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
  const [past, setPast] = useState<UndoCommand[]>([]);
  const [future, setFuture] = useState<UndoCommand[]>([]);
  const [busy, setBusy] = useState(false);
  /** Per transaction: version → the version this tab's own save took it to. */
  const steps = useRef(new Map<string, Map<number, number>>());

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

  const record = useCallback((command: UndoCommand) => {
    setPast((commands) => [...commands, command]);
    setFuture([]);
  }, []);

  const undo = useCallback(async () => {
    const command = past.at(-1);
    if (!command || busy) return;
    setBusy(true);
    try {
      await command.undo();
      setPast((commands) => commands.slice(0, -1));
      setFuture((commands) => [...commands, command]);
    } catch (error) {
      if (isStaleVersion(error)) setPast((commands) => commands.slice(0, -1));
      throw error;
    } finally {
      setBusy(false);
    }
  }, [past, busy]);

  const redo = useCallback(async () => {
    const command = future.at(-1);
    if (!command || busy) return;
    setBusy(true);
    try {
      await command.redo();
      setFuture((commands) => commands.slice(0, -1));
      setPast((commands) => [...commands, command]);
    } catch (error) {
      if (isStaleVersion(error)) setFuture((commands) => commands.slice(0, -1));
      throw error;
    } finally {
      setBusy(false);
    }
  }, [future, busy]);

  return (
    <UndoContext.Provider
      value={{
        noteSave,
        expectedVersion,
        undoLabel: past.at(-1)?.label ?? null,
        redoLabel: future.at(-1)?.label ?? null,
        busy,
        record,
        undo,
        redo,
      }}
    >
      {children}
    </UndoContext.Provider>
  );
}

export function useUndo() {
  const value = useContext(UndoContext);
  if (!value) throw new Error("useUndo must be used inside UndoProvider");
  return value;
}

/** Browser-native undo keeps priority while the user is typing in an editable control. */
function isEditing(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
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
