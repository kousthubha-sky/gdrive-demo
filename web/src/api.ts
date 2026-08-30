export type User = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
};

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: string;
  updatedAt: string;
  ownerId: string;
  owner: User;
  shares: { user: User }[];
};

export type Scope = "all" | "mine" | "shared";

export class ApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", ...init });
  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(body?.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const api = {
  me: () => request<User>("/api/auth/me"),

  logout: () => request<void>("/api/auth/logout", { method: "POST" }),

  listFiles: (q: string, scope: Scope) => {
    const params = new URLSearchParams({ scope });
    if (q.trim()) params.set("q", q.trim());
    return request<DriveFile[]>(`/api/files?${params}`);
  },

  rename: (id: string, name: string) =>
    request<DriveFile>(`/api/files/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),

  remove: (id: string) => request<void>(`/api/files/${id}`, { method: "DELETE" }),

  share: (id: string, email: string) =>
    request<DriveFile>(`/api/files/${id}/shares`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }),

  unshare: (id: string, userId: string) =>
    request<void>(`/api/files/${id}/shares/${userId}`, { method: "DELETE" }),

  downloadUrl: (id: string, disposition: "attachment" | "inline" = "attachment") =>
    request<{ url: string }>(`/api/files/${id}/url?disposition=${disposition}`),

  /** XHR rather than fetch: it is the only way to get upload progress events. */
  upload(file: File, onProgress: (percent: number) => void) {
    return new Promise<DriveFile>((resolve, reject) => {
      const form = new FormData();
      form.append("file", file);

      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/files");
      xhr.withCredentials = true;
      // Lets XHR parse the response itself: `response` is null if it isn't JSON.
      xhr.responseType = "json";

      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      });
      xhr.addEventListener("load", () => {
        const body = xhr.response as (DriveFile & { error?: string }) | null;
        if (body && xhr.status >= 200 && xhr.status < 300) resolve(body);
        else reject(new ApiError(body?.error ?? `Upload failed (${xhr.status})`));
      });
      xhr.addEventListener("error", () => reject(new ApiError("Upload failed - network error")));
      xhr.addEventListener("abort", () => reject(new ApiError("Upload cancelled")));

      xhr.send(form);
    });
  },
};

export function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  return `${value < 10 && i > 0 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

export function formatDate(iso: string) {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
