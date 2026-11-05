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
  /** Other words it's found by. */
  keywords?: readonly string[];
  /** The keys that run it too, shown beside it. */
  caps?: readonly KeyCap[];
  /** "general" for the shell's own (help, sidebar); the rest belong to the screen showing. */
  group: "screen" | "general";
  run: () => void;
}

type Entry = ScreenCommand & { key: string };

/** How long a command started elsewhere waits for the screen it needs to offer it. */
const WAIT_MS = 5000;

/**
 * The commands registered right now, in registration order, and what opens on request: the
 * palette goes to a screen and then starts something there (a register's add row, a category's
 * Move popover) once that screen has mounted.
 */
class CommandRegistry {
  private entries = new Map<string, Entry>();
  private snapshot: readonly Entry[] = [];
  private listeners = new Set<() => void>();
  private openers = new Map<string, (() => void)[]>();
  private pending: { target: string; until: number } | null = null;

  /** Runs the command labelled `label` now, or as soon as a screen offers it (for a while). */
  runWhenOffered(label: string) {
    const find = () => this.snapshot.find((c) => c.label === label);
    const now = find();
    if (now) return void now.run();
    const timer = setTimeout(() => stop(), WAIT_MS);
    const stop = this.subscribe(() => {
      const offered = find();
      if (!offered) return;
      stop();
      clearTimeout(timer);
      // After the effects that offered it, so the screen has finished mounting.
      setTimeout(offered.run, 0);
    });
  }

  /** Opens what listens for `target` now, or once it mounts (for a while). */
  request(target: string) {
    const open = this.openers.get(target)?.[0];
    if (open) {
      this.pending = null;
      open();
    } else {
      this.pending = { target, until: Date.now() + WAIT_MS };
    }
  }

  listen(target: string, open: () => void) {
    this.openers.set(target, [...(this.openers.get(target) ?? []), open]);
    if (this.pending?.target === target) {
      if (Date.now() < this.pending.until) setTimeout(open, 0);
      this.pending = null;
    }
    return () => {
      const rest = (this.openers.get(target) ?? []).filter((o) => o !== open);
      if (rest.length) this.openers.set(target, rest);
      else this.openers.delete(target);
    };
  }

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

/** Starts things on other screens (see `CommandRegistry`); null outside the provider. */
export function useCommandRegistry(): Pick<CommandRegistry, "runWhenOffered" | "request"> | null {
  return useContext(RegistryContext);
}

/**
 * Opens something (a popover) when the palette requests `target`, now or once this mounts.
 * Without a target it listens for nothing.
 */
export function useOpenRequest(target: string | undefined, open: () => void) {
  const registry = useContext(RegistryContext);
  const latest = useRef(open);
  latest.current = open;
  useEffect(() => {
    if (!registry || !target) return;
    return registry.listen(target, () => latest.current());
  }, [registry, target]);
}

/** What opens a category's Move popover on the plan. */
export const moveTarget = (categoryId: string) => `move:${categoryId}`;

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
  keywords,
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
  const keywordsKey = keywords?.join("\n");
  useEffect(() => {
    if (!registry || !enabled) return;
    registry.set(key, { label, keywords, caps, group, run: () => latest.current() });
    return () => registry.delete(key);
  }, [registry, key, label, capsKey, keywordsKey, group, enabled]);
}
