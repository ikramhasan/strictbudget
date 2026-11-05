import { describe, expect, it } from "vitest";
import { bulkDoneMessage, bulkLabel, bulkRemoves } from "./register-undo";

describe("bulk actions in the undo history", () => {
  it("names each as what Undo would take back", () => {
    expect(`Undo ${bulkLabel({ type: "delete" }, 2)}`).toBe("Undo delete 2 transactions");
    expect(bulkLabel({ type: "reject" }, 1)).toBe("reject 1 transaction");
    expect(bulkLabel({ type: "cleared", cleared: "uncleared" }, 3)).toBe(
      "mark 3 transactions uncleared",
    );
    expect(bulkLabel({ type: "flag", flag: null }, 2)).toBe("remove the flag from 2 transactions");
    expect(bulkLabel({ type: "flag", flag: "red" }, 2)).toBe("flag 2 transactions");
    expect(bulkLabel({ type: "enterNow" }, 2)).toBe("enter 2 transactions now");
    expect(bulkLabel({ type: "memo", memo: "x" }, 2)).toBe("change the memo on 2 transactions");
  });

  it("says what was done, and which ones remove transactions", () => {
    expect(bulkDoneMessage({ type: "delete" }, 2)).toBe("Deleted 2 transactions");
    expect(bulkDoneMessage({ type: "categorize", categoryId: "c" }, 1)).toBe(
      "Updated 1 transaction",
    );
    expect(bulkRemoves({ type: "delete" })).toBe(true);
    expect(bulkRemoves({ type: "reject" })).toBe(true);
    expect(bulkRemoves({ type: "duplicate" })).toBe(false);
  });
});
