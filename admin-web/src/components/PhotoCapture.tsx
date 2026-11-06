import { useRef, useState, type ChangeEvent } from "react";
import { api, ApiError } from "../api/client";

export interface UploadedPhoto {
  id: string;
  url: string;
}

/**
 * `capture="environment"` opens the phone's rear camera directly on iOS
 * Safari and Android Chrome instead of a file picker; on desktop browsers
 * that ignore it, this is just a normal file input.
 */
export function PhotoCapture({
  kind,
  label = "Take photo",
  onUploaded,
}: {
  kind: string;
  label?: string;
  onUploaded: (photo: UploadedPhoto) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const photo = await api.uploadFile<UploadedPhoto>("/media", file, { kind });
      onUploaded(photo);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not upload photo");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      <label className="secondary" style={{ display: "inline-block", padding: "8px 14px", borderRadius: "var(--radius)", background: "#e5e7eb", cursor: "pointer", fontSize: 13 }}>
        <input ref={inputRef} type="file" accept="image/*" capture="environment" onChange={handleChange} style={{ display: "none" }} disabled={uploading} />
        {uploading ? "Uploading..." : label}
      </label>
      {error && <div className="error-banner" style={{ marginTop: 6 }}>{error}</div>}
    </div>
  );
}

/** The backend returns either an absolute URL (Cloudflare R2) or a path relative to the API (local disk) — only prefix the latter. */
function resolvePhotoUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const API_URL = import.meta.env.VITE_API_URL ?? `http://${window.location.hostname}:3000`;
  return `${API_URL}${url}`;
}

export function PhotoThumbnails({ photos, onRemove }: { photos: UploadedPhoto[]; onRemove?: (id: string) => void }) {
  if (photos.length === 0) return null;
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
      {photos.map((p) => (
        <div key={p.id} style={{ position: "relative" }}>
          <img src={resolvePhotoUrl(p.url)} alt="" style={{ width: 72, height: 72, objectFit: "cover", borderRadius: "var(--radius)", border: "1px solid var(--border)" }} />
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(p.id)}
              style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, padding: 0, borderRadius: "50%", fontSize: 11, lineHeight: "20px" }}
            >
              ✕
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
