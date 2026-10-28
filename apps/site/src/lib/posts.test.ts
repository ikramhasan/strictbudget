import { describe, expect, it } from "vitest";
import { byDate, formatDate, readingTime, related } from "./posts";

const post = (id: string, date: string) => ({ id, data: { date: new Date(date) } });

describe("readingTime", () => {
  it("rounds to whole minutes at 230 words a minute", () => {
    expect(readingTime(Array.from({ length: 690 }, () => "word").join(" "))).toBe(3);
  });

  it("is at least a minute", () => {
    expect(readingTime("")).toBe(1);
  });
});

describe("formatDate", () => {
  it("formats in UTC", () => {
    expect(formatDate(new Date("2026-10-21"))).toBe("Oct 21, 2026");
  });
});

describe("related", () => {
  const posts = [post("a", "2026-09-12"), post("b", "2026-10-21"), post("c", "2026-10-09")];

  it("leaves out the current post and lists the rest newest first", () => {
    expect(related(posts, "b").map((p) => p.id)).toEqual(["c", "a"]);
  });

  it("stops at the count", () => {
    expect(related(posts, "x", 2).map((p) => p.id)).toEqual(["b", "c"]);
  });

  it("doesn't reorder its input", () => {
    byDate(posts);
    expect(posts.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });
});
