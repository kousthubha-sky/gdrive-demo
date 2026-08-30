import { useCallback, useEffect, useRef, useState } from "react";
import { HardDrive, LogOut, Plus, Search, Users } from "lucide-react";
import { api, type DriveFile, type Scope, type User } from "./api";
import { Avatar } from "./components/Avatar";
import { FileTable } from "./components/FileTable";
import { Login } from "./components/Login";
import { Modal } from "./components/Modal";
import { ShareDialog } from "./components/ShareDialog";

type Upload = { id: number; name: string; percent: number };

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<Scope>("mine");
  const [rawQuery, setRawQuery] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [renaming, setRenaming] = useState<DriveFile | null>(null);
  // Only the id: the dialog reads the live row out of `files`, so a share it
  // adds shows up without a second copy of the file going stale here.
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  // OAuth failures come back as an ?error= param on the landing URL.
  const oauthError = new URLSearchParams(window.location.search).get("error");

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  // Debounce so typing in the search box doesn't fire a query per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQuery(rawQuery), 250);
    return () => clearTimeout(t);
  }, [rawQuery]);

  // Bumped per request so a slow earlier list can't land on top of a newer one
  // - typing quickly fires overlapping searches that return out of order.
  const listRequest = useRef(0);

  const refresh = useCallback(async () => {
    if (!user) return;
    const id = ++listRequest.current;
    setLoading(true);
    try {
      const next = await api.listFiles(query, scope);
      if (id !== listRequest.current) return;
      setFiles(next);
      setError(null);
    } catch (err) {
      if (id !== listRequest.current) return;
      setError((err as Error).message);
    } finally {
      if (id === listRequest.current) setLoading(false);
    }
  }, [user, query, scope]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function uploadFiles(list: FileList | File[]) {
    for (const file of Array.from(list)) {
      const id = Date.now() + Math.random();
      setUploads((u) => [...u, { id, name: file.name, percent: 0 }]);
      try {
        await api.upload(file, (percent) =>
          setUploads((u) => u.map((x) => (x.id === id ? { ...x, percent } : x)))
        );
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setUploads((u) => u.filter((x) => x.id !== id));
      }
    }
    await refresh();
  }

  async function download(file: DriveFile) {
    try {
      const { url } = await api.downloadUrl(file.id);
      window.location.href = url;
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(file: DriveFile) {
    if (!window.confirm(`Delete "${file.name}"? This cannot be undone.`)) return;
    try {
      await api.remove(file.id);
      setFiles((f) => f.filter((x) => x.id !== file.id));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (user === undefined) {
    return <div className="flex min-h-full items-center justify-center text-muted">Loading…</div>;
  }

  if (user === null) {
    return <Login error={oauthError ? "Google sign-in failed. Please try again." : null} />;
  }

  return (
    <div
      className="flex min-h-full flex-col"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) void uploadFiles(e.dataTransfer.files);
      }}
    >
      <header className="flex items-center gap-4 border-b border-line bg-surface px-4 py-3">
        <div className="flex items-center gap-2 font-medium">
          <HardDrive size={20} className="text-accent" />
          <span className="hidden sm:inline">Drive</span>
        </div>

        <div className="relative mx-auto w-full max-w-xl">
          <Search size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <input
            value={rawQuery}
            onChange={(e) => setRawQuery(e.target.value)}
            placeholder="Search in Drive"
            aria-label="Search files by name"
            className="w-full rounded-full bg-canvas py-2.5 pr-4 pl-10 text-sm outline-none focus:bg-surface focus:ring-2 focus:ring-accent/40"
          />
        </div>

        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-muted md:inline">{user.email}</span>
          <Avatar url={user.avatarUrl} name={user.name} size="md" />
          <button
            type="button"
            onClick={async () => {
              // Sign out locally whatever the server says: leaving someone
              // looking signed in on a shared machine is the worse failure.
              try {
                await api.logout();
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setUser(null);
              }
            }}
            aria-label="Sign out"
            className="rounded-full p-2 text-muted transition hover:bg-canvas"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <div className="flex flex-1">
        <aside className="hidden w-56 shrink-0 flex-col gap-1 p-4 sm:flex">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="mb-4 flex items-center gap-3 self-start rounded-2xl border border-line bg-surface py-3.5 pr-6 pl-4 text-sm font-medium shadow-sm transition hover:shadow-md"
          >
            <Plus size={20} className="text-accent" />
            New
          </button>

          <NavItem icon={HardDrive} label="My Drive" active={scope === "mine"} onClick={() => setScope("mine")} />
          <NavItem icon={Users} label="Shared with me" active={scope === "shared"} onClick={() => setScope("shared")} />
        </aside>

        <main className="flex-1 p-4 sm:pl-0">
          <div className="overflow-hidden rounded-2xl border border-line bg-surface">
            <div className="flex items-center justify-between border-b border-line px-4 py-3 sm:hidden">
              <span className="text-sm font-medium">
                {scope === "shared" ? "Shared with me" : "My Drive"}
              </span>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-white"
              >
                <Plus size={14} /> New
              </button>
            </div>

            <FileTable
              files={files}
              me={user}
              loading={loading}
              query={query}
              onDownload={download}
              onRename={setRenaming}
              onShare={(file) => setSharingId(file.id)}
              onDelete={remove}
            />
          </div>
        </main>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) void uploadFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {dragging && (
        <div className="pointer-events-none fixed inset-4 z-30 flex items-center justify-center rounded-3xl border-2 border-dashed border-accent bg-accent-soft/70 text-lg font-medium text-accent">
          Drop files to upload
        </div>
      )}

      {uploads.length > 0 && (
        <div className="fixed right-4 bottom-4 z-30 w-72 overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
          <p className="border-b border-line px-4 py-2 text-sm font-medium">
            Uploading {uploads.length} file{uploads.length > 1 ? "s" : ""}
          </p>
          {uploads.map((u) => (
            <div key={u.id} className="px-4 py-2">
              <p className="truncate text-xs text-muted">{u.name}</p>
              <div className="mt-1 h-1 rounded-full bg-canvas">
                <div
                  className="h-1 rounded-full bg-accent transition-all"
                  style={{ width: `${u.percent}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-lg bg-ink px-4 py-2.5 text-sm text-white shadow-lg">
          {error}
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-4 text-white/70 hover:text-white"
          >
            Dismiss
          </button>
        </div>
      )}

      <RenameDialog
        file={renaming}
        onClose={() => setRenaming(null)}
        onDone={(updated) => {
          setFiles((f) => f.map((x) => (x.id === updated.id ? updated : x)));
          setRenaming(null);
        }}
        onError={setError}
      />

      <ShareDialog
        file={files.find((f) => f.id === sharingId) ?? null}
        onClose={() => setSharingId(null)}
        onChanged={(updated) => {
          if (updated) setFiles((f) => f.map((x) => (x.id === updated.id ? updated : x)));
          else void refresh();
        }}
      />
    </div>
  );
}

function NavItem({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: typeof HardDrive;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-3 rounded-full px-4 py-2 text-sm transition ${
        active ? "bg-accent-soft font-medium text-accent" : "text-ink hover:bg-line/50"
      }`}
    >
      <Icon size={18} />
      {label}
    </button>
  );
}

function RenameDialog({
  file,
  onClose,
  onDone,
  onError,
}: {
  file: DriveFile | null;
  onClose: () => void;
  onDone: (file: DriveFile) => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => setName(file?.name ?? ""), [file]);

  return (
    <Modal open={Boolean(file)} title="Rename" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!file) return;
          setBusy(true);
          try {
            onDone(await api.rename(file.id, name));
          } catch (err) {
            onError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-accent hover:bg-accent-soft"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
