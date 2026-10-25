import { type CurrencyCode, money, toDecimalString } from "@strictbudget/engine";

/**
 * A payee as the bank wrote it that names one of these stores gets a "<Store>.com Order History"
 * link. Case and punctuation don't count ("WAL-MART #1234" is Walmart); Amazon Web Services gets
 * none.
 */
const STORES: readonly { key: string; label: string; url: (amount: string) => string }[] = [
  {
    key: "amazon",
    label: "Amazon.com Order History",
    // Points the page at the amount (a text fragment).
    url: (amount) => `https://www.amazon.com/cpe/yourpayments/transactions#:~:text=${amount}`,
  },
  {
    key: "applecom",
    label: "Apple.com Order History",
    url: () => "https://reportaproblem.apple.com/?s=6",
  },
  {
    key: "costco",
    label: "Costco.com Order History",
    url: () => "https://www.costco.com/OrderStatusCmd",
  },
  {
    key: "samsclub",
    label: "SamsClub.com Order History",
    url: () => "https://www.samsclub.com/order/history?xid=account_order-history",
  },
  { key: "target", label: "Target.com Order History", url: () => "https://www.target.com/orders" },
  {
    key: "walmart",
    label: "Walmart.com Order History",
    url: () => "https://www.walmart.com/orders",
  },
];

export function storeOrderLink(
  statementName: string,
  amount: bigint,
  currency: CurrencyCode,
): { label: string; url: string } | null {
  const plain = statementName.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (plain.includes("amazonwebservices") || /\baws\b/i.test(statementName)) return null;
  const store = STORES.find((s) => plain.includes(s.key));
  if (!store) return null;
  const magnitude = toDecimalString(money(amount < 0n ? -amount : amount, currency));
  return { label: store.label, url: store.url(magnitude) };
}
