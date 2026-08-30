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
  Trash2,
  Users,
} from "lucide-react";
import { formatBytes, formatDate, type DriveFile, type User } from "../api";

function iconFor(mime: string) {
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
  onDownload: (file: DriveFile) => void;
  onRename: (file: DriveFile) => void;
  onShare: (file: DriveFile) => void;
  onDelete: (file: DriveFile) => void;
};

export function FileTable({ files, me, loading, query, onDownload, onRename, onShare, onDelete }: Props) {
  // Anchored in viewport coordinates and positioned `fixed`, because the table
  // sits inside an `overflow-hidden` wrapper that would otherwise clip the menu
  // for the bottom rows and leave Rename/Share/Delete unreachable.
  const [menu, setMenu] = useState<{ id: string; top: number; right: number } | null>(null);

  function toggleMenu(e: React.MouseEvent<HTMLButtonElement>, id: string, isOwner: boolean) {
    if (menu?.id === id) return setMenu(null);
    const r = e.currentTarget.getBoundingClientRect();
    const height = isOwner ? 152 : 44;
    const roomBelow = window.innerHeight - r.bottom;
    setMenu({
      id,
      top: roomBelow > height + 8 ? r.bottom + 4 : r.top - height - 4,
      right: window.innerWidth - r.right,
    });
  }

  if (loading) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded-lg bg-canvas" />
        ))}
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-canvas text-muted">
          <FileIcon size={28} />
        </div>
        <p className="mt-4 font-medium">{query ? `No files match "${query}"` : "No files yet"}</p>
        <p className="mt-1 text-sm text-muted">
          {query ? "Try a different search term." : "Drop a file anywhere, or use the New button."}
        </p>
      </div>
    );
  }

  return (
    <>
      {menu && (
        <div className="fixed inset-0 z-10" onClick={() => setMenu(null)} onWheel={() => setMenu(null)} />
      )}

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs font-medium tracking-wide text-muted uppercase">
            <th className="px-4 py-3 font-medium">Name</th>
            <th className="hidden px-4 py-3 font-medium sm:table-cell">Owner</th>
            <th className="hidden px-4 py-3 font-medium md:table-cell">Modified</th>
            <th className="hidden px-4 py-3 font-medium md:table-cell">Size</th>
            <th className="w-12 px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {files.map((file) => {
            const Icon = iconFor(file.mimeType);
            const isOwner = file.ownerId === me.id;
            return (
              <tr
                key={file.id}
                onDoubleClick={() => onDownload(file)}
                className="group border-b border-line/70 transition last:border-0 hover:bg-canvas"
              >
                <td className="px-4 py-2.5">
                  <div className="flex min-w-0 items-center gap-3">
                    <Icon size={18} className="shrink-0 text-accent" />
                    <span className="min-w-0 truncate font-medium" title={file.name}>
                      {file.name}
                    </span>
                    {isOwner && file.shares.length > 0 && (
                      <span
                        title={`Shared with ${file.shares.map((s) => s.user.email).join(", ")}`}
                        className="flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent"
                      >
                        <Users size={12} />
                        {file.shares.length}
                      </span>
                    )}
                  </div>
                </td>
                <td className="hidden px-4 py-2.5 text-muted sm:table-cell">
                  {isOwner ? "me" : file.owner.name}
                </td>
                <td className="hidden px-4 py-2.5 text-muted md:table-cell">
                  {formatDate(file.updatedAt)}
                </td>
                <td className="hidden px-4 py-2.5 text-muted md:table-cell">
                  {formatBytes(file.size)}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <button
                    type="button"
                    aria-label={`Actions for ${file.name}`}
                    onClick={(e) => toggleMenu(e, file.id, isOwner)}
                    className="rounded-full p-1.5 text-muted transition hover:bg-line/60"
                  >
                    <MoreVertical size={16} />
                  </button>

                  {menu?.id === file.id && (
                    <div
                      style={{ top: menu.top, right: menu.right }}
                      className="fixed z-20 w-44 overflow-hidden rounded-xl border border-line bg-surface py-1 text-left shadow-lg"
                    >
                      <MenuItem icon={Download} label="Download" onClick={() => { setMenu(null); onDownload(file); }} />
                      {isOwner && (
                        <>
                          <MenuItem icon={Pencil} label="Rename" onClick={() => { setMenu(null); onRename(file); }} />
                          <MenuItem icon={Users} label="Share" onClick={() => { setMenu(null); onShare(file); }} />
                          <MenuItem
                            icon={Trash2}
                            label="Delete"
                            danger
                            onClick={() => { setMenu(null); onDelete(file); }}
                          />
                        </>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function MenuItem({
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
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-4 py-2 text-sm transition hover:bg-canvas ${
        danger ? "text-red-600" : ""
      }`}
    >
      <Icon size={15} />
      {label}
    </button>
  );
}
