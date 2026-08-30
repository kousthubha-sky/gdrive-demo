import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LogOut, Plus, Search, Trash2 } from "lucide-react";
import { api, type DriveFile, type Scope, type Storage, type User } from "./api";
import { Avatar } from "./components/Avatar";
import { FileGrid } from "./components/FileGrid";
import { applyFilters, FilterChips, noFilters, type Filters } from "./components/Filters";
import { Login } from "./components/Login";
import { Modal } from "./components/Modal";
import { ShareDialog } from "./components/ShareDialog";
import { Sidebar } from "./components/Sidebar";

type Upload = { id: number; name: string; percent: number };

const titles: Record<Scope, string> = {
  all: "Home",
  mine: "My Drive",
  shared: "Shared with me",
  recent: "Recent",
  starred: "Starred",
  trash: "Trash",
};

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [storage, setStorage] = useState<Storage | null>(null);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<Scope>("mine");
  const [filters, setFilters] = useState<Filters>(noFilters);
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
  const inTrash = scope === "trash";

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

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [list, used] = await Promise.all([api.listFiles(query, scope), api.storage()]);
      setFiles(list);
      setStorage(used);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [user, query, scope]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visible = useMemo(
    () => (user ? applyFilters(files, filters, user.id) : []),
    [files, filters, user]
  );

  /** Swap an updated row in place, or drop it if it no longer belongs here. */
  function replace(updated: DriveFile) {
    setFiles((f) =>
      // A file trashed while browsing My Drive, or restored while browsing
      // Trash, no longer belongs in the list it came from.
      Boolean(updated.trashedAt) === inTrash
        ? f.map((x) => (x.id === updated.id ? updated : x))
        : f.filter((x) => x.id !== updated.id)
    );
  }

  async function run(action: () => Promise<void>) {
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    }
  }

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
      <header className="flex items-center gap-4 px-4 py-2.5">
        <div className="flex shrink-0 items-center gap-2 text-xl md:w-52">
          <DriveMark />
          <span className="hidden text-ink/90 sm:inline">Drive</span>
        </div>

        <div className="relative mx-auto w-full max-w-2xl">
          <Search size={18} className="absolute top-1/2 left-4 -translate-y-1/2 text-muted" />
          <input
            value={rawQuery}
            onChange={(e) => setRawQuery(e.target.value)}
            placeholder="Search in Drive"
            aria-label="Search files by name"
            className="w-full rounded-full bg-raised py-3 pr-4 pl-12 text-sm text-ink outline-none placeholder:text-muted focus:bg-surface focus:ring-1 focus:ring-line"
          />
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <span className="hidden text-sm text-muted lg:inline">{user.email}</span>
          <Avatar url={user.avatarUrl} name={user.name} size="md" />
          <button
            type="button"
            onClick={async () => {
              await api.logout();
              setUser(null);
            }}
            aria-label="Sign out"
            className="rounded-full p-2 text-muted transition hover:bg-raised"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-2 pr-2 pb-2">
        <Sidebar
          scope={scope}
          onScope={setScope}
          onNew={() => inputRef.current?.click()}
          storage={storage}
        />

        <main className="min-w-0 flex-1 overflow-y-auto rounded-2xl bg-surface p-6">
          <div className="mb-5 flex items-center justify-between gap-4">
            <h1 className="text-2xl">{titles[scope]}</h1>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="flex items-center gap-1.5 rounded-full bg-raised px-4 py-2 text-sm transition hover:bg-line/60 md:hidden"
              >
                <Plus size={16} /> New
              </button>

              {inTrash && files.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    if (!window.confirm(`Permanently delete all ${files.length} file(s) in trash?`)) return;
                    void run(async () => {
                      await api.emptyTrash();
                      await refresh();
                    });
                  }}
                  className="flex items-center gap-2 rounded-full border border-line px-4 py-2 text-sm text-danger transition hover:bg-raised"
                >
                  <Trash2 size={15} /> Empty trash
                </button>
              )}
            </div>
          </div>

          {!inTrash && (
            <div className="mb-6">
              <FilterChips value={filters} onChange={setFilters} />
            </div>
          )}

          <FileGrid
            files={visible}
            me={user}
            loading={loading}
            query={query}
            inTrash={inTrash}
            onDownload={(file) =>
              void run(async () => {
                const { url } = await api.downloadUrl(file.id);
                window.location.href = url;
              })
            }
            onRename={setRenaming}
            onShare={(file) => setSharingId(file.id)}
            onStar={(file) =>
              void run(async () => replace(await api.setStarred(file.id, !file.starred)))
            }
            onTrash={(file) => void run(async () => replace(await api.remove(file.id)))}
            onRestore={(file) => void run(async () => replace(await api.restore(file.id)))}
            onDeleteForever={(file) => {
              if (!window.confirm(`Permanently delete "${file.name}"? This cannot be undone.`)) return;
              void run(async () => {
                await api.deleteForever(file.id);
                setFiles((f) => f.filter((x) => x.id !== file.id));
                setStorage(await api.storage());
              });
            }}
          />
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
        <div className="pointer-events-none fixed inset-4 z-30 flex items-center justify-center rounded-3xl border-2 border-dashed border-accent bg-accent-soft/40 text-lg font-medium text-accent">
          Drop files to upload
        </div>
      )}

      {uploads.length > 0 && (
        <div className="fixed right-4 bottom-4 z-30 w-72 overflow-hidden rounded-xl border border-line bg-raised shadow-2xl">
          <p className="border-b border-line px-4 py-2 text-sm font-medium">
            Uploading {uploads.length} file{uploads.length > 1 ? "s" : ""}
          </p>
          {uploads.map((u) => (
            <div key={u.id} className="px-4 py-2">
              <p className="truncate text-xs text-muted">{u.name}</p>
              <div className="mt-1 h-1 rounded-full bg-line">
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
        <div
          role="alert"
          className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-lg border border-line bg-raised px-4 py-2.5 text-sm shadow-2xl"
        >
          {error}
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-4 text-accent hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <RenameDialog
        file={renaming}
        onClose={() => setRenaming(null)}
        onDone={(updated) => {
          replace(updated);
          setRenaming(null);
        }}
        onError={setError}
      />

      <ShareDialog
        file={files.find((f) => f.id === sharingId) ?? null}
        onClose={() => setSharingId(null)}
        onChanged={(updated) => (updated ? replace(updated) : void refresh())}
      />
    </div>
  );
}

/** Google Drive's triangle mark, so the header matches the design. */
function DriveMark() {
  return (
    <svg width="26" height="23" viewBox="0 0 87.3 78" aria-hidden="true">
      <path fill="#0066da" d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5z" />
      <path fill="#00ac47" d="M43.65 25 29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44A9.06 9.06 0 0 0 0 53h27.5z" />
      <path fill="#ea4335" d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.5l5.85 11.5z" />
      <path fill="#00832d" d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" />
      <path fill="#2684fc" d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" />
      <path fill="#ffba00" d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25l16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" />
    </svg>
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
          className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-5 py-2 text-sm text-accent transition hover:bg-raised"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-canvas transition hover:brightness-110 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
