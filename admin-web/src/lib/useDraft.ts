import { useEffect, useState } from "react";

/**
 * Keeps a form's state mirrored into localStorage under `draft:${key}`, so
 * navigating away mid-form (e.g. to create a SKU from a half-filled PO) and
 * coming back restores exactly what was typed. Call `clearDraft()` after a
 * successful submit so the next visit starts blank again.
 */
export function useDraft<T>(key: string, initial: T) {
  const storageKey = `draft:${key}`;
  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      // private browsing / quota exceeded — draft persistence is a convenience, not critical
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, state]);

  function clearDraft() {
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
    setState(initial);
  }

  return [state, setState, clearDraft] as const;
}
