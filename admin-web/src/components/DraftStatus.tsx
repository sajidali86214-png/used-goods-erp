import { useEffect, useState } from "react";

/** Shows "Draft saved Xs ago" next to a form using useDraft, so the silent localStorage save is actually visible. */
export function DraftStatus({ lastSavedAt }: { lastSavedAt: Date | null }) {
  const [, forceTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 5000);
    return () => clearInterval(id);
  }, []);

  if (!lastSavedAt) return null;

  const seconds = Math.max(0, Math.round((Date.now() - lastSavedAt.getTime()) / 1000));
  const label = seconds < 5 ? "just now" : seconds < 60 ? `${seconds}s ago` : `${Math.round(seconds / 60)}m ago`;

  return (
    <span style={{ fontSize: 12, color: "var(--text-muted)" }} title="Saved to this browser only — not yet submitted">
      Draft saved {label}
    </span>
  );
}
