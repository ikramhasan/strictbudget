import { price } from "./site";

const text = {
  monthly: {
    amount: `$${price.monthly}`,
    per: "per month",
    note: `or $${price.yearly} a year, billed once`,
  },
  yearly: {
    amount: `$${price.yearly}`,
    per: "per year",
    note: `That's $${price.yearly / 12} a month, billed once a year`,
  },
};

/** The pricing section's Monthly/Yearly switch: swaps the hosted plan's price. */
export function initBilling() {
  const group = document.querySelector<HTMLElement>("[data-billing]");
  if (!group) return;
  const buttons = group.querySelectorAll<HTMLButtonElement>("button[data-period]");
  for (const button of buttons) {
    button.addEventListener("click", () => {
      const period = button.dataset.period === "yearly" ? "yearly" : "monthly";
      for (const b of buttons) b.setAttribute("aria-pressed", String(b === button));
      for (const key of ["amount", "per", "note"] as const) {
        const el = document.querySelector(`[data-price="${key}"]`);
        if (el) el.textContent = text[period][key];
      }
    });
  }
}
