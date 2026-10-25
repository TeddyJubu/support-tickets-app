/** Make a safe KB filename from a human-readable article title. */
export function articleFilenameFromTitle(title: string) {
  const base = title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100)
    .replace(/-+$/g, "");
  return base ? `${base}.md` : null;
}
