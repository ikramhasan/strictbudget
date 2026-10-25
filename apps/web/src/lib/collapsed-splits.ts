import { useCallback, useState } from "react";

/** Which splits are folded away, by transaction id, in one entry for every budget and register. */
const STORAGE_KEY = "strictbudget:collapsed-splits";
/** Folds kept; the oldest go first, so deleted transactions' ids don't pile up for good. */
const MAX_FOLDED = 500;

function read(): Record<string, true> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return value && typeof value === "object" ? (value as Record<string, true>) : {};
  } catch {
    return {};
  }
}

export function useCollapsedSplits() {
  const [collapsed, setCollapsed] = useState(read);
  const toggle = useCallback((id: string) => {
    setCollapsed((current) => {
      const { [id]: was, ...rest } = current;
      // Insertion order is fold order, so the oldest folds come first.
      const next: Record<string, true> = was
        ? rest
        : Object.fromEntries(
            [...Object.keys(current), id].slice(-MAX_FOLDED).map((key) => [key, true] as const),
          );
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Blocked storage: the fold still applies until the page closes.
      }
      return next;
    });
  }, []);
  return [collapsed, toggle] as const;
}
