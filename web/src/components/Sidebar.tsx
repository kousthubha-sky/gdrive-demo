import { Clock, Cloud, HardDrive, House, Plus, Star, Trash2, Users } from "lucide-react";
import { formatBytes, type Scope, type Storage } from "../api";

type Props = {
  scope: Scope;
  onScope: (scope: Scope) => void;
  onNew: () => void;
  storage: Storage | null;
};

const groups: { scope: Scope; label: string; icon: typeof House }[][] = [
  [
    { scope: "all", label: "Home", icon: House },
    { scope: "mine", label: "My Drive", icon: HardDrive },
  ],
  [
    { scope: "shared", label: "Shared with me", icon: Users },
    { scope: "recent", label: "Recent", icon: Clock },
    { scope: "starred", label: "Starred", icon: Star },
  ],
  [{ scope: "trash", label: "Trash", icon: Trash2 }],
];

export function Sidebar({ scope, onScope, onNew, storage }: Props) {
  const percent = storage && storage.quota > 0 ? (storage.used / storage.quota) * 100 : 0;

  return (
    <aside className="hidden w-60 shrink-0 flex-col gap-1 px-3 pb-4 md:flex">
      <button
        type="button"
        onClick={onNew}
        className="mb-4 ml-2 flex w-fit items-center gap-3 rounded-2xl bg-raised py-4 pr-6 pl-4 text-sm font-medium shadow-sm transition hover:bg-line/60"
      >
        <Plus size={20} />
        New
      </button>

      {groups.map((group, i) => (
        <div key={i} className={i > 0 ? "mt-3 border-t border-line/60 pt-3" : undefined}>
          {group.map(({ scope: value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => onScope(value)}
              aria-current={scope === value ? "page" : undefined}
              className={`flex w-full items-center gap-4 rounded-full px-4 py-2 text-left text-sm transition ${
                scope === value
                  ? "bg-accent-soft font-medium text-ink"
                  : "text-ink/90 hover:bg-raised"
              }`}
            >
              <Icon size={18} className="shrink-0" />
              {label}
            </button>
          ))}
        </div>
      ))}

      <div className="mt-3 border-t border-line/60 px-4 pt-4">
        <p className="flex items-center gap-4 text-sm text-ink/90">
          <Cloud size={18} className="shrink-0" />
          Storage
        </p>
        {storage && (
          <>
            <div
              role="progressbar"
              aria-label="Storage used"
              aria-valuenow={Math.round(percent)}
              aria-valuemin={0}
              aria-valuemax={100}
              className="mt-3 h-1 w-full rounded-full bg-line"
            >
              <div
                className={`h-1 rounded-full ${percent > 90 ? "bg-danger" : "bg-accent"}`}
                style={{ width: `${Math.min(percent, 100)}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-muted">
              {formatBytes(storage.used)} of {formatBytes(storage.quota)} used
            </p>
          </>
        )}
      </div>
    </aside>
  );
}
