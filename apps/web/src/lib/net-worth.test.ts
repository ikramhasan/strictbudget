import { describe, expect, it } from "vitest";
import {
  accountHistory,
  composition,
  exportFile,
  exportRows,
  headline,
  monthRows,
  type NetWorthAccount,
  type NetWorthMonth,
  percentLabel,
  shownAccounts,
  usedKinds,
  waterfall,
  waterfallScale,
} from "./net-worth";

const month = (m: string, assets: string, debts: string, extra: Partial<NetWorthMonth> = {}) =>
  ({
    month: m,
    assets,
    debts,
    netWorth: (BigInt(assets) + BigInt(debts)).toString(),
    allTimeHigh: false,
    missing: [],
    parts: { netSaved: "0", debtPaidDown: "0", tracking: "0", other: "0" },
    ...extra,
  }) satisfies NetWorthMonth;

const account = (
  name: string,
  type: NetWorthAccount["type"],
  balances: (string | null)[],
  extra: Partial<NetWorthAccount> = {},
): NetWorthAccount => ({
  id: name,
  name,
  type,
  onBudget: true,
  closed: false,
  currency: "USD",
  firstMonth: "2026-08",
  opening: { native: "0", base: "0" },
  balances: balances.map((b) => ({ native: b ?? "0", base: b })),
  ...extra,
});

describe("percentLabel", () => {
  it("writes a one-decimal percent of |base|", () => {
    expect(percentLabel(-1_596_674n, -30_668_700n)).toBe("-5.2%");
    expect(percentLabel(-32_265_174n, -200n)).toBe("-16,132,587.0%");
    expect(percentLabel(0n, -200n)).toBe("0.0%");
    expect(percentLabel(100n, 0n)).toBeNull();
    expect(percentLabel(1n, 2000n)).toBe("0.1%");
  });
});

describe("monthRows and headline", () => {
  const report = {
    opening: { month: "2026-07", assets: "0", debts: "-200", netWorth: "-200" },
    months: [
      month("2026-08", "0", "-200"),
      month("2026-09", "1000", "-30669700"),
      month("2026-10", "1343800", "-33609174"),
    ],
  };

  it("lists months newest first, each against the month before", () => {
    const rows = monthRows(report);
    expect(rows.map((r) => [r.month, r.netWorth, r.change, r.changePercent])).toEqual([
      ["2026-10", -32_265_374n, -1_596_674n, "-5.2%"],
      ["2026-09", -30_668_700n, -30_668_500n, "-15,334,250.0%"],
      ["2026-08", -200n, 0n, "0.0%"],
    ]);
  });

  it("takes the Change in Net Worth from the first month in the range", () => {
    expect(headline(report)).toEqual({
      netWorth: -32_265_374n,
      assets: 1_343_800n,
      debts: -33_609_174n,
      rangeChange: -32_265_174n,
      rangePercent: "-16,132,587.0%",
      monthChange: -1_596_674n,
      monthPercent: "-5.2%",
    });
    expect(headline({ ...report, months: [] })).toBeNull();
  });
});

describe("waterfall", () => {
  it("runs from last month's net worth through the parts to this month's", () => {
    const steps = waterfall(
      100_000n,
      month("2026-10", "150000", "-20000", {
        parts: { netSaved: "40000", debtPaidDown: "90000", tracking: "-5000", other: "-95000" },
      }),
    );
    expect(steps.map((s) => [s.key, s.amount, s.low, s.high])).toEqual([
      ["start", 100_000n, 0n, 100_000n],
      ["netSaved", 40_000n, 100_000n, 140_000n],
      ["debtPaidDown", 90_000n, 140_000n, 230_000n],
      ["tracking", -5_000n, 225_000n, 230_000n],
      ["other", -95_000n, 130_000n, 225_000n],
      ["end", 130_000n, 0n, 130_000n],
    ]);
    // The last part ends where this month's bar does.
    expect(steps[4]?.low).toBe(steps[5]?.high);
  });

  it("zooms the axis onto the change, totals growing from its edge", () => {
    const parts = {
      netSaved: "5000",
      debtPaidDown: "215000",
      tracking: "119000",
      other: "-173314",
    };
    const steps = waterfall(-21_239_299n, month("2026-10", "0", "-21073613", { parts }));
    // Running totals from −$212,392.99 up to −$209,002.99, back to −$210,736.13; a quarter of
    // that span is added on each side.
    const scale = waterfallScale(steps);
    expect(scale).toEqual({ low: -21_324_049n, high: -20_815_549n, baseline: -20_815_549n });
    // A net worth near zero keeps zero as the baseline.
    const small = waterfallScale(
      waterfall(
        100n,
        month("2026-10", "600", "0", {
          parts: { ...parts, netSaved: "500", debtPaidDown: "0", tracking: "0", other: "0" },
        }),
      ),
    );
    expect(small.baseline).toBe(0n);
    expect(small.low).toBe(-25n);
  });
});

describe("composition", () => {
  it("sums balances by account kind, leaving out ones with no rate", () => {
    const rows = composition({
      months: [month("2026-09", "0", "0"), month("2026-10", "0", "0")],
      accounts: [
        account("Checking", "checking", ["1000", "2000"]),
        account("Wallet", "cash", ["50", "50"]),
        account("Visa", "credit_card", ["-300", "0"]),
        account("Euros", "savings", ["500", null]),
      ],
    });
    expect(rows[0]?.sums).toMatchObject({ cash: 1050n, savings: 500n, credit: -300n, loans: 0n });
    expect(rows[1]?.sums).toMatchObject({ cash: 2050n, savings: 0n, credit: 0n });
    expect(usedKinds(rows)).toEqual(["cash", "savings", "credit"]);
  });
});

describe("export", () => {
  const report = {
    months: [month("2026-09", "500000", "-12000"), month("2026-10", "500000", "0")],
    accounts: [
      account("Visa", "credit_card", ["-12000", "0"]),
      account("House", "asset", ["500000", "500000"]),
      account("Yen", "cash", [null, null], { currency: "JPY" }),
    ],
  };

  it("writes the rows: accounts, then Net Worth", () => {
    expect(exportRows(report, 2, "comma_dot")).toEqual([
      ["Account", "Sep 2026", "Oct 2026"],
      ["Visa", { raw: "-120.00" }, { raw: "0.00" }],
      ["House", { raw: "5000.00" }, { raw: "5000.00" }],
      ["Yen", { raw: "" }, { raw: "" }],
      ["Net Worth", { raw: "4880.00" }, { raw: "5000.00" }],
    ]);
  });

  it("is a CSV without a byte-order mark, TSV for comma decimals", () => {
    const csv = exportFile(report, 2, "comma_dot", ",", "2026-10-17");
    expect(csv.name).toBe("net-worth-2026-10-17.csv");
    expect(csv.text.split("\n")[0]).toBe('"Account","Sep 2026","Oct 2026"');
    expect(csv.text.charCodeAt(0)).toBe(34);
    expect(csv.text.endsWith("\n")).toBe(false);
    const tsv = exportFile(report, 2, "dot_comma", "\t", "2026-10-17");
    expect(tsv.name).toBe("net-worth-2026-10-17.tsv");
    expect(tsv.text.split("\n")[1]).toBe('"Visa"\t-120,00\t0,00');
  });
});

describe("accounts", () => {
  it("lists accounts with a balance in the range and one account's history", () => {
    const report = {
      months: [month("2026-08", "0", "0"), month("2026-09", "0", "0"), month("2026-10", "0", "0")],
      accounts: [
        account("Old", "savings", ["0", "0", "0"], { closed: true }),
        account("New", "checking", ["0", "0", "700"], { firstMonth: "2026-09" }),
      ],
    };
    expect(shownAccounts(report).map((a) => a.name)).toEqual(["New"]);
    expect(accountHistory(report, "New")).toEqual([
      { month: "2026-09", balance: 0n },
      { month: "2026-10", balance: 700n },
    ]);
    expect(accountHistory(report, "Missing")).toEqual([]);
  });
});
