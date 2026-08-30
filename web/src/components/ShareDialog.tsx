import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { api, type DriveFile } from "../api";
import { Avatar } from "./Avatar";
import { Modal } from "./Modal";

type Props = {
  file: DriveFile | null;
  onClose: () => void;
  onChanged: (file?: DriveFile) => void;
};

export function ShareDialog({ file, onClose, onChanged }: Props) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The dialog is reused for every file, so a half-typed address or an error
  // from the last one must not follow us to the next.
  useEffect(() => {
    setEmail("");
    setError(null);
  }, [file?.id]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onChanged(await api.share(file.id, email));
      setEmail("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(userId: string) {
    if (!file) return;
    setError(null);
    try {
      await api.unshare(file.id, userId);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal open={Boolean(file)} title={file ? `Share "${file.name}"` : "Share"} onClose={onClose}>
      <form onSubmit={submit} className="flex gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email of a person who has signed in"
          className="min-w-0 flex-1 rounded-lg border border-line bg-canvas px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-canvas transition hover:brightness-110 disabled:opacity-50"
        >
          {busy ? "Sharing…" : "Share"}
        </button>
      </form>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      <div className="mt-5">
        <p className="text-xs font-medium tracking-wide text-muted uppercase">People with access</p>
        <ul className="mt-2 space-y-1">
          <li className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm">
            <Avatar url={file?.owner.avatarUrl ?? null} name={file?.owner.name ?? ""} />
            <span className="flex-1 truncate">{file?.owner.email}</span>
            <span className="text-xs text-muted">Owner</span>
          </li>
          {file?.shares.map(({ user }) => (
            <li key={user.id} className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-raised">
              <Avatar url={user.avatarUrl} name={user.name} />
              <span className="flex-1 truncate">{user.email}</span>
              <button
                type="button"
                onClick={() => revoke(user.id)}
                aria-label={`Remove ${user.email}`}
                className="rounded-full p-1 text-muted transition hover:bg-line/60"
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
