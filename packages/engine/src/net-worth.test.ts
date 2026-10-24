import { describe, expect, it } from "vitest";
import {
  allTimeHighs,
  type NetWorthFlows,
  netWorthGroup,
  netWorthParts,
  netWorthTotals,
} from "./net-worth";

describe("netWorthTotals", () => {
  it("splits by each account's sign, not its type", () => {
    // An asset account at −$6 counts in debts, a liability at +$19 in assets.
    expect(netWorthTotals([1_138_500n, -600n, 1_900n, -10_100n, 0n])).toEqual({
      assets: 1_140_400n,
      debts: -10_700n,
      netWorth: 1_129_700n,
    });
  });

  it("leaves out balances with no rate", () => {
    expect(netWorthTotals([500n, null, -200n])).toEqual({
      assets: 500n,
      debts: -200n,
      netWorth: 300n,
    });
  });
});

describe("netWorthGroup", () => {
  it("puts cash and credit in the budget group", () => {
    expect(netWorthGroup("checking")).toBe("budget");
    expect(netWorthGroup("line_of_credit")).toBe("budget");
    expect(netWorthGroup("mortgage")).toBe("loan");
    expect(netWorthGroup("liability")).toBe("tracking");
  });
});

describe("netWorthParts", () => {
  const flow = (f: Partial<NetWorthFlows> & Pick<NetWorthFlows, "group">): NetWorthFlows => ({
    total: 0n,
    starting: 0n,
    transfers: 0n,
    ...f,
  });

  it("adds up to the change exactly", () => {
    // Income $3,000, spending $1,200 on a card, $900 to the mortgage (of which $650 interest and
    // escrow came back as charges), $500 into an investment that also gained $40, and a new
    // savings account opened with $250.
    const flows = [
      flow({ group: "budget", total: 300_000n - 90_000n - 50_000n, transfers: -140_000n }),
      flow({ group: "budget", total: -120_000n }),
      flow({ group: "budget", total: 25_000n, starting: 25_000n }),
      flow({ group: "loan", total: 90_000n - 65_000n, transfers: 90_000n }),
      flow({ group: "tracking", total: 54_000n, transfers: 50_000n }),
    ];
    const change = flows.reduce((s, f) => s + f.total, 0n);
    const parts = netWorthParts(change, flows);
    expect(parts).toEqual({
      netSaved: 40_000n,
      debtPaidDown: 90_000n,
      tracking: 54_000n,
      other: -40_000n,
    });
    expect(parts.netSaved + parts.debtPaidDown + parts.tracking + parts.other).toBe(change);
  });

  it("puts what the flows don't explain (exchange rates) in other", () => {
    const parts = netWorthParts(1_234n, [flow({ group: "budget", total: 1_000n })]);
    expect(parts).toEqual({ netSaved: 1_000n, debtPaidDown: 0n, tracking: 0n, other: 234n });
  });
});

describe("allTimeHighs", () => {
  it("marks months above every earlier month-end, not the first or a tie", () => {
    expect(allTimeHighs([-200n, -100n, -100n, -300n, -50n, 0n, -10n])).toEqual([
      false,
      true,
      false,
      false,
      true,
      true,
      false,
    ]);
    expect(allTimeHighs([])).toEqual([]);
  });
});
