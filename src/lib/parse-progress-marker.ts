const PROGRESS_MARKER_PATTERN = /\[(\d{1,3})%\]/;

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&#91;", "[")
    .replaceAll("&#93;", "]")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseProgressMarker(descriptionHtml: string | null | undefined): number | null {
  if (!descriptionHtml) {
    return null;
  }

  const text = stripHtml(descriptionHtml);
  const match = text.match(PROGRESS_MARKER_PATTERN);

  if (!match) {
    return null;
  }

  const progress = Number(match[1]);

  if (!Number.isFinite(progress) || progress < 0 || progress > 100) {
    return null;
  }

  return progress;
}
