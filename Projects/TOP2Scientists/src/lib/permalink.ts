export const PUBLIC_CARD_BASE = "https://csgaobb.github.io/Projects/TOP2Scientists/";

export function scientistPermalink(id: number) {
  let base = PUBLIC_CARD_BASE;
  if (typeof window !== "undefined" && window.location.hostname.endsWith("github.io")) {
    const path = window.location.pathname.replace(/index\.html$/i, "");
    const folder = path.endsWith("/") ? path : `${path}/`;
    base = `${window.location.origin}${folder}`;
  }
  return `${base}?id=${id}`;
}
