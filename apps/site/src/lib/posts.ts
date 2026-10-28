/** Minutes to read `text` at 230 words a minute, at least one. */
export function readingTime(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 230));
}

/** "Oct 21, 2026", in UTC so a post's date doesn't shift with the build machine's zone. */
export function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Newest first. */
export function byDate<T extends { data: { date: Date } }>(posts: T[]): T[] {
  return [...posts].sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

/** Up to `count` other posts, newest first, for the end of a post. */
export function related<T extends { id: string; data: { date: Date } }>(
  posts: T[],
  id: string,
  count = 3,
): T[] {
  return byDate(posts.filter((post) => post.id !== id)).slice(0, count);
}
