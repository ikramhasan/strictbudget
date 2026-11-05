import { useCallback, useState } from "react";

/**
 * Which splits show their lines, by transaction id, in one entry for every budget and register.
 * Splits start folded, so the register shows more transactions.
 */
const STORAGE_KEY = "strictbudget:expanded-splits";
/** Expanded splits kept; the oldest go first, so deleted transactions' ids don't pile up for good. */
const MAX_EXPANDED = 500;

function read(): Record<string, true> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return value && typeof value === "object" ? (value as Record<string, true>) : {};
  } catch {
    return {};
  }
}

export function useExpandedSplits() {
  const [expanded, setExpanded] = useState(read);
  const toggle = useCallback((id: string) => {
    setExpanded((current) => {
      const { [id]: was, ...rest } = current;
      // Insertion order is expand order, so the oldest come first.
      const next: Record<string, true> = was
        ? rest
        : Object.fromEntries(
            [...Object.keys(current), id].slice(-MAX_EXPANDED).map((key) => [key, true] as const),
          );
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Blocked storage: the change still applies until the page closes.
      }
      return next;
    });
  }, []);
  return [expanded, toggle] as const;
}
