import { describe, expect, it } from "vitest";
import { INACTIVE_MEMBERS, type MoneyMove, matchesMember, memberFilterOptions } from "./moves";

const move = (over: Partial<MoneyMove>): MoneyMove => ({
  id: "m",
  kind: "assigned",
  fromCategoryId: null,
  toCategoryId: "a",
  fromDeletedCategory: null,
  toDeletedCategory: null,
  deletion: false,
  picture: null,
  month: "2026-10",
  amount: "100",
  movedAt: "2026-10-16T12:00:00.000Z",
  autoAssign: null,
  userId: "owner",
  userName: "ihni7",
  memberRole: "owner",
  avatarColor: 1,
  removed: false,
  ...over,
});

const members = [
  { userId: "owner", name: "ihni7" },
  { userId: "pat", name: "Pat" },
];

describe("Recent Moves member filter", () => {
  it("lists every member, even one without moves", () => {
    expect(memberFilterOptions([move({})], members)).toEqual([
      { value: "owner", label: "ihni7" },
      { value: "pat", label: "Pat" },
    ]);
  });

  it("adds someone who left only if they made a move, and Inactive members for deleted users", () => {
    const moves = [
      move({ userId: "sam", userName: "Sam", memberRole: null, avatarColor: null, removed: true }),
      move({ userId: null, userName: null, memberRole: null, avatarColor: null, removed: true }),
    ];
    expect(memberFilterOptions(moves, members)).toEqual([
      { value: "owner", label: "ihni7" },
      { value: "pat", label: "Pat" },
      { value: "sam", label: "Sam (removed)" },
      { value: INACTIVE_MEMBERS, label: "Inactive members" },
    ]);
  });

  it("keeps only the chosen member's moves", () => {
    const pat = move({ userId: "pat", userName: "Pat" });
    const gone = move({ userId: null, userName: null });
    const own = move({});
    expect([pat, gone, own].filter((m) => matchesMember(m, "pat"))).toEqual([pat]);
    expect([pat, gone, own].filter((m) => matchesMember(m, INACTIVE_MEMBERS))).toEqual([gone]);
    expect([pat, gone, own].filter((m) => matchesMember(m, ""))).toHaveLength(3);
  });
});
