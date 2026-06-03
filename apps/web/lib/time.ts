export function timeAgo(date?: Date | string | null): string {
  if (!date) return "";
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function fmtDuration(
  start: Date | string,
  end: Date | string | null,
): string {
  if (!end) return "—";
  const sec = Math.round(
    (new Date(end).getTime() - new Date(start).getTime()) / 1000,
  );
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}
