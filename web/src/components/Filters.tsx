import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { DriveFile } from "../api";

export type Filters = {
  type: "any" | "document" | "image" | "video" | "audio" | "archive";
  people: "any" | "me" | "others";
  modified: "any" | "today" | "week" | "month" | "year";
};

export const noFilters: Filters = { type: "any", people: "any", modified: "any" };

const typeMatchers: Record<Exclude<Filters["type"], "any">, (mime: string) => boolean> = {
  document: (m) => m.startsWith("text/") || m.includes("pdf") || m.includes("document") || m.includes("sheet"),
  image: (m) => m.startsWith("image/"),
  video: (m) => m.startsWith("video/"),
  audio: (m) => m.startsWith("audio/"),
  archive: (m) => m.includes("zip") || m.includes("compressed") || m.includes("tar"),
};

const maxAgeDays: Record<Exclude<Filters["modified"], "any">, number> = {
  today: 1,
  week: 7,
  month: 30,
  year: 365,
};

/**
 * Applied in the browser: the list endpoint already caps at 500 rows, so
 * narrowing them costs nothing and keeps every chip instant.
 */
export function applyFilters(files: DriveFile[], f: Filters, myId: string) {
  return files.filter((file) => {
    if (f.type !== "any" && !typeMatchers[f.type](file.mimeType)) return false;
    if (f.people === "me" && file.ownerId !== myId) return false;
    if (f.people === "others" && file.ownerId === myId) return false;
    if (f.modified !== "any") {
      const ageMs = Date.now() - new Date(file.updatedAt).getTime();
      if (ageMs > maxAgeDays[f.modified] * 86_400_000) return false;
    }
    return true;
  });
}

const options = {
  type: [
    ["any", "Type"],
    ["document", "Documents"],
    ["image", "Images"],
    ["video", "Video"],
    ["audio", "Audio"],
    ["archive", "Archives"],
  ],
  people: [
    ["any", "People"],
    ["me", "Owned by me"],
    ["others", "Shared with me"],
  ],
  modified: [
    ["any", "Modified"],
    ["today", "Today"],
    ["week", "Last 7 days"],
    ["month", "Last 30 days"],
    ["year", "This year"],
  ],
} as const satisfies Record<keyof Filters, readonly (readonly [string, string])[]>;

type Props = { value: Filters; onChange: (next: Filters) => void };

export function FilterChips({ value, onChange }: Props) {
  const dirty = value.type !== "any" || value.people !== "any" || value.modified !== "any";

  return (
    <div className="flex flex-wrap gap-2">
      {(Object.keys(options) as (keyof Filters)[]).map((key) => (
        <ChipSelect
          key={key}
          label={options[key][0][1]}
          choices={options[key]}
          value={value[key]}
          onSelect={(next) => onChange({ ...value, [key]: next } as Filters)}
        />
      ))}

      {dirty && (
        <button
          type="button"
          onClick={() => onChange(noFilters)}
          className="rounded-full px-3 py-1.5 text-sm text-accent transition hover:bg-raised"
        >
          Clear
        </button>
      )}
    </div>
  );
}

/**
 * A native <select> would be less code, but its popup is drawn by the OS: it
 * stays light on a dark page and cannot be made to match the rest of the menus.
 */
function ChipSelect({
  label,
  choices,
  value,
  onSelect,
}: {
  label: string;
  choices: readonly (readonly [string, string])[];
  value: string;
  onSelect: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const active = value !== "any";
  const current = choices.find(([v]) => v === value)?.[1] ?? label;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="relative">
      {open && <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />}

      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 rounded-full border py-1.5 pr-2.5 pl-3.5 text-sm transition ${
          active
            ? "border-accent-soft bg-accent-soft text-ink"
            : "border-line text-ink/90 hover:bg-raised"
        }`}
      >
        {current}
        <ChevronDown size={16} className={open ? "rotate-180 transition" : "transition"} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-full left-0 z-20 mt-1 w-52 overflow-hidden rounded-xl border border-line bg-raised py-1 shadow-2xl"
        >
          {choices.map(([v, text]) => (
            <button
              key={v}
              type="button"
              role="menuitemradio"
              aria-checked={v === value}
              onClick={() => {
                onSelect(v);
                setOpen(false);
                triggerRef.current?.focus();
              }}
              className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition hover:bg-line/50"
            >
              <Check size={15} className={v === value ? "text-accent" : "invisible"} />
              {v === "any" ? `Any ${label.toLowerCase()}` : text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
