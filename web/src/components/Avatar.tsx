const sizes = {
  sm: "size-7 text-xs",
  md: "size-8 text-sm",
} as const;

/**
 * Google's profile image, or the initial when there isn't one. `no-referrer`
 * matters: without it Google serves a 403 for the hotlinked image.
 */
export function Avatar({
  url,
  name,
  size = "sm",
}: {
  url: string | null;
  name: string;
  size?: keyof typeof sizes;
}) {
  if (url) {
    return (
      <img src={url} alt="" referrerPolicy="no-referrer" className={`${sizes[size]} rounded-full`} />
    );
  }
  return (
    <span
      className={`${sizes[size]} flex items-center justify-center rounded-full bg-accent-soft font-medium text-accent`}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
