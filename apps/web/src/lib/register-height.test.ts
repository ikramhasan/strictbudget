import { describe, expect, it } from "vitest";
import { MIN_REGISTER_HEIGHT, remainingHeight } from "./register-height";

describe("remainingHeight", () => {
  it("takes the rest of the page's scroll area below the register's top", () => {
    // A 760px window: 704px of page under the top bar, the register 120px down, 20px of padding.
    expect(remainingHeight({ viewportHeight: 704, contentTop: 120, bottomPadding: 20 })).toBe(564);
  });

  it("keeps a usable list under a tall header, the page scrolling instead", () => {
    expect(remainingHeight({ viewportHeight: 500, contentTop: 400, bottomPadding: 20 })).toBe(
      MIN_REGISTER_HEIGHT,
    );
  });
});
