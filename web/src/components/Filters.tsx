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

type Props = { value: Filters; onChange: (next: Filters) => void };

export function FilterChips({ value, onChange }: Props) {
  const active = (key: keyof Filters) => value[key] !== "any";

  return (
    <div className="flex flex-wrap gap-2">
      <Chip label="Type" active={active("type")}>
        <select
          aria-label="Filter by type"
          value={value.type}
          onChange={(e) => onChange({ ...value, type: e.target.value as Filters["type"] })}
          className="cursor-pointer bg-transparent outline-none"
        >
          <option value="any">Type</option>
          <option value="document">Documents</option>
          <option value="image">Images</option>
          <option value="video">Video</option>
          <option value="audio">Audio</option>
          <option value="archive">Archives</option>
        </select>
      </Chip>

      <Chip label="People" active={active("people")}>
        <select
          aria-label="Filter by people"
          value={value.people}
          onChange={(e) => onChange({ ...value, people: e.target.value as Filters["people"] })}
          className="cursor-pointer bg-transparent outline-none"
        >
          <option value="any">People</option>
          <option value="me">Owned by me</option>
          <option value="others">Shared with me</option>
        </select>
      </Chip>

      <Chip label="Modified" active={active("modified")}>
        <select
          aria-label="Filter by modified date"
          value={value.modified}
          onChange={(e) => onChange({ ...value, modified: e.target.value as Filters["modified"] })}
          className="cursor-pointer bg-transparent outline-none"
        >
          <option value="any">Modified</option>
          <option value="today">Today</option>
          <option value="week">Last 7 days</option>
          <option value="month">Last 30 days</option>
          <option value="year">This year</option>
        </select>
      </Chip>

      {(active("type") || active("people") || active("modified")) && (
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

function Chip({
  active,
  children,
}: {
  label: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`rounded-full border px-3 py-1.5 text-sm transition ${
        active ? "border-accent-soft bg-accent-soft text-ink" : "border-line text-ink/90 hover:bg-raised"
      }`}
    >
      {children}
    </span>
  );
}
