// Falls back to whatever host the page itself was loaded from (not a
// hardcoded "localhost") so the same build works from a phone on the LAN
// (e.g. http://192.168.1.39:5173) without needing a per-device .env value.
const API_URL = import.meta.env.VITE_API_URL ?? `http://${window.location.hostname}:3000`;
const TOKEN_KEY = "erp_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    super(typeof body === "object" && body && "error" in body ? String((body as { error: unknown }).error) : `Request failed (${status})`);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  // Only set Content-Type when there's actually a body — Fastify's JSON
  // parser rejects a declared application/json body that's empty (found by
  // actually calling a bodyless POST route like .../approve against the
  // real backend, not assumed).
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;

  if (!res.ok) {
    throw new ApiError(res.status, data);
  }
  return data as T;
}

async function uploadFile<T>(path: string, file: File | Blob, fields: Record<string, string> = {}): Promise<T> {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append("file", file, file instanceof File ? file.name : "photo.jpg");

  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  // No Content-Type here — the browser sets multipart/form-data with the
  // correct boundary itself; setting it manually breaks the boundary.

  const res = await fetch(`${API_URL}${path}`, { method: "POST", headers, body: form });
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

/** Fetches a binary response (e.g. a generated PDF) and triggers a browser download — auth needs the Bearer header, so a plain <a href> to the API can't be used directly. */
async function downloadFile(path: string, filename: string): Promise<void> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(res.status, text ? JSON.parse(text) : undefined);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
  uploadFile,
  downloadFile,
};
