/**
 * Moves preferences saved under the product's former name (`everycent:…`, `everycent.…`) to
 * their current keys, once per browser. A key already saved under the new name wins.
 */
export function migrateLegacyStorage(storage: Storage = localStorage): void {
  try {
    const legacy: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.includes("everycent")) legacy.push(key);
    }
    for (const key of legacy) {
      const value = storage.getItem(key);
      const renamed = key.replaceAll("everycent", "strictbudget");
      if (value !== null && storage.getItem(renamed) === null) storage.setItem(renamed, value);
      storage.removeItem(key);
    }
  } catch {
    // Blocked storage has nothing to move.
  }
}
