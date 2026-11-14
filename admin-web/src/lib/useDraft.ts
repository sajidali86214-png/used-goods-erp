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
      if (!raw) return initial;
      const parsed = JSON.parse(raw) as T;
      // A shallow merge over `initial` — not the raw parsed value — so a
      // draft saved under an older shape (a field renamed, added, or turned
      // into an array by a later change to this form) still produces a
      // valid object instead of crashing the page with a missing field.
      // Only safe for object-shaped drafts, which every call site here is.
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? { ...initial, ...parsed } : initial;
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
