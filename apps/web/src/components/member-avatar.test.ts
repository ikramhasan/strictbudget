import { describe, expect, it } from "vitest";
import { avatarPattern } from "./member-avatar";

describe("avatarPattern (same-initial patterns)", () => {
  const members = [
    { userId: "owner", name: "Ihni7" },
    { userId: "b", name: "Ikram Monsha" },
    { userId: "c", name: "Sam" },
    { userId: "d", name: "ilse" },
    { userId: "e", name: "Ivy" },
  ];

  it("leaves the first with an initial plain and numbers the others in member order", () => {
    expect(avatarPattern(members, "owner")).toBe(0);
    expect(avatarPattern(members, "b")).toBe(1);
    expect(avatarPattern(members, "e")).toBe(2);
    expect(avatarPattern(members, "c")).toBe(0);
  });

  it("groups by the exact character, so i and I differ", () => {
    expect(avatarPattern(members, "d")).toBe(0);
  });

  it("gives no pattern to someone who isn't a member", () => {
    expect(avatarPattern(members, "gone")).toBe(0);
  });

  it("stops at the fifth pattern", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ userId: `u${i}`, name: `Al ${i}` }));
    expect(avatarPattern(many, "u5")).toBe(5);
    expect(avatarPattern(many, "u7")).toBe(5);
  });
});
