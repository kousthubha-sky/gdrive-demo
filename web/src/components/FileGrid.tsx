import { useState } from "react";
import {
  Download,
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Image as ImageIcon,
  MoreVertical,
  Pencil,
  RotateCcw,
  Star,
  Trash2,
  Users,
} from "lucide-react";
import { formatBytes, formatDate, type DriveFile, type User } from "../api";

export function iconFor(mime: string) {
  if (mime.startsWith("image/")) return ImageIcon;
  if (mime.startsWith("video/")) return FileVideo;
  if (mime.startsWith("audio/")) return FileAudio;
  if (mime.includes("zip") || mime.includes("compressed") || mime.includes("tar")) return FileArchive;
  if (mime.includes("sheet") || mime.includes("csv") || mime.includes("excel")) return FileSpreadsheet;
  if (mime.startsWith("text/") || mime.includes("pdf") || mime.includes("document")) return FileText;
  return FileIcon;
}

type Props = {
  files: DriveFile[];
  me: User;
  loading: boolean;
  query: string;
  inTrash: boolean;
  onDownload: (file: DriveFile) => void;
  onRename: (file: DriveFile) => void;
  onShare: (file: DriveFile) => void;
  onStar: (file: DriveFile) => void;
  onTrash: (file: DriveFile) => void;
  onRestore: (file: DriveFile) => void;
  onDeleteForever: (file: DriveFile) => void;
};

export function FileGrid({
  files,
  me,
  loading,
  query,
  inTrash,
  onDownload,
  onRename,
  onShare,
  onStar,
  onTrash,
  onRestore,
  onDeleteForever,
}: Props) {
  const [menuFor, setMenuFor] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-56 animate-pulse rounded-xl bg-raised" />
        ))}
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-28 text-center">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-raised text-muted">
          {inTrash ? <Trash2 size={28} /> : <FileIcon size={28} />}
        </div>
        <p className="mt-4 font-medium">
          {query ? `No files match "${query}"` : inTrash ? "Trash is empty" : "No files yet"}
        </p>
        <p className="mt-1 text-sm text-muted">
          {query
            ? "Try a different search term."
            : inTrash
              ? "Files you move to trash show up here."
              : "Drop a file anywhere, or use the New button."}
        </p>
      </div>
    );
  }

  return (
    <>
      {menuFor && <div className="fixed inset-0 z-10" onClick={() => setMenuFor(null)} />}

      <ul className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4">
        {files.map((file) => {
          const Icon = iconFor(file.mimeType);
          const isOwner = file.ownerId === me.id;

          return (
            <li
              key={file.id}
              onDoubleClick={() => !inTrash && onDownload(file)}
              className="group relative rounded-xl border border-line/70 bg-surface transition hover:border-line hover:bg-raised"
            >
              <div className="flex items-center gap-3 px-3 py-2.5">
                <Icon size={18} className="shrink-0 text-accent" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium" title={file.name}>
                  {file.name}
                </span>
                {file.starred && !inTrash && (
                  <Star size={14} className="shrink-0 fill-current text-accent" />
                )}
                <button
                  type="button"
                  aria-label={`Actions for ${file.name}`}
                  aria-haspopup="menu"
                  aria-expanded={menuFor === file.id}
                  onClick={() => setMenuFor(menuFor === file.id ? null : file.id)}
                  className="-mr-1 rounded-full p-1.5 text-muted transition hover:bg-line/60"
                >
                  <MoreVertical size={16} />
                </button>
              </div>

              {/* A tile rather than a real thumbnail: previewing every card would
                  mean one presigned request per file on every list render. */}
              <div className="mx-3 mb-3 flex h-36 items-center justify-center rounded-lg bg-canvas">
                <Icon size={40} className="text-line" />
              </div>

              <div className="flex items-center justify-between gap-2 px-3 pb-3 text-xs text-muted">
                <span className="truncate">
                  {inTrash
                    ? `Trashed ${formatDate(file.trashedAt ?? file.updatedAt)}`
                    : isOwner
                      ? formatDate(file.updatedAt)
                      : file.owner.name}
                </span>
                <span className="shrink-0">{formatBytes(file.size)}</span>
              </div>

              {menuFor === file.id && (
                <div
                  role="menu"
                  className="absolute top-11 right-3 z-20 w-48 overflow-hidden rounded-xl border border-line bg-raised py-1 text-left shadow-2xl"
                >
                  {inTrash ? (
                    <>
                      <Item icon={RotateCcw} label="Restore" onClick={() => { setMenuFor(null); onRestore(file); }} />
                      <Item
                        icon={Trash2}
                        label="Delete forever"
                        danger
                        onClick={() => { setMenuFor(null); onDeleteForever(file); }}
                      />
                    </>
                  ) : (
                    <>
                      <Item icon={Download} label="Download" onClick={() => { setMenuFor(null); onDownload(file); }} />
                      {isOwner && (
                        <>
                          <Item icon={Pencil} label="Rename" onClick={() => { setMenuFor(null); onRename(file); }} />
                          <Item
                            icon={Star}
                            label={file.starred ? "Remove from starred" : "Add to starred"}
                            onClick={() => { setMenuFor(null); onStar(file); }}
                          />
                          <Item icon={Users} label="Share" onClick={() => { setMenuFor(null); onShare(file); }} />
                          <div className="my-1 border-t border-line/70" />
                          <Item
                            icon={Trash2}
                            label="Move to trash"
                            onClick={() => { setMenuFor(null); onTrash(file); }}
                          />
                        </>
                      )}
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Item({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: typeof Download;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-4 py-2 text-sm transition hover:bg-line/50 ${
        danger ? "text-danger" : ""
      }`}
    >
      <Icon size={15} />
      {label}
    </button>
  );
}
