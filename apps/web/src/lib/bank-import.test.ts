import { describe, expect, it } from "vitest";
import { storeOrderLink } from "./bank-import";

describe("Bank Import Details store links", () => {
  it("links the known stores, ignoring case and punctuation", () => {
    expect(storeOrderLink("AMAZON MKTPL*X1 Amzn.com/bill", -1100n, "USD")).toEqual({
      label: "Amazon.com Order History",
      url: "https://www.amazon.com/cpe/yourpayments/transactions#:~:text=11.00",
    });
    expect(storeOrderLink("WAL-MART #1234", -1200n, "USD")?.url).toBe(
      "https://www.walmart.com/orders",
    );
    expect(storeOrderLink("APPLE.COM/BILL", -1400n, "USD")?.label).toBe("Apple.com Order History");
    expect(storeOrderLink("TARGET 00012345", -2300n, "USD")?.url).toBe(
      "https://www.target.com/orders",
    );
    expect(storeOrderLink("SAMS CLUB #6789", -2200n, "USD")?.label).toBe(
      "SamsClub.com Order History",
    );
    expect(storeOrderLink("COSTCO WHSE #0123", -2100n, "USD")?.url).toBe(
      "https://www.costco.com/OrderStatusCmd",
    );
  });

  it("gives Amazon Web Services and other payees none", () => {
    expect(storeOrderLink("AMAZON WEB SERVICES AWS", -1300n, "USD")).toBeNull();
    expect(storeOrderLink("CORNER CAFE", -500n, "USD")).toBeNull();
  });
});
