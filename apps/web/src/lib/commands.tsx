import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { KeyCap } from "./shortcuts";

/** An action a screen offers the command palette while it can run. */
export interface ScreenCommand {
  label: string;
  /** The keys that run it too, shown beside it. */
  caps?: readonly KeyCap[];
  /** "general" for the shell's own (help, sidebar); the rest belong to the screen showing. */
  group: "screen" | "general";
  run: () => void;
}

type Entry = ScreenCommand & { key: string };

/** The commands registered right now, in registration order. */
class CommandRegistry {
  private entries = new Map<string, Entry>();
  private snapshot: readonly Entry[] = [];
  private listeners = new Set<() => void>();

  set(key: string, command: ScreenCommand) {
    this.entries.set(key, { ...command, key });
    this.emit();
  }

  delete(key: string) {
    if (this.entries.delete(key)) this.emit();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  get = () => this.snapshot;

  private emit() {
    this.snapshot = [...this.entries.values()];
    for (const listener of this.listeners) listener();
  }
}

const RegistryContext = createContext<CommandRegistry | null>(null);

/** Collects what the screens offer, for the command palette inside it. */
export function CommandRegistryProvider({ children }: { children: ReactNode }) {
  const [registry] = useState(() => new CommandRegistry());
  return <RegistryContext.Provider value={registry}>{children}</RegistryContext.Provider>;
}

const NONE: readonly Entry[] = [];
const noop = () => () => {};

export function useScreenCommands(): readonly Entry[] {
  const registry = useContext(RegistryContext);
  return useSyncExternalStore(registry?.subscribe ?? noop, registry?.get ?? (() => NONE));
}

/**
 * Offers an action to the command palette while `enabled`. Outside the provider (a component
 * rendered on its own in a test) it does nothing.
 */
export function useCommand({
  label,
  caps,
  group = "screen",
  run,
  enabled = true,
}: Omit<ScreenCommand, "group"> & { group?: ScreenCommand["group"]; enabled?: boolean }) {
  const registry = useContext(RegistryContext);
  const key = useId();
  // The latest callback runs without registering again on every render.
  const latest = useRef(run);
  latest.current = run;
  const capsKey = caps?.join(" ");
  useEffect(() => {
    if (!registry || !enabled) return;
    registry.set(key, { label, caps, group, run: () => latest.current() });
    return () => registry.delete(key);
  }, [registry, key, label, capsKey, group, enabled]);
}
