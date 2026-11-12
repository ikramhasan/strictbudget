import { price } from "./site";

export type Period = "monthly" | "yearly";

/** The hosted plan's price lines for each billing period. Yearly leads with its monthly cost. */
export const billingText: Record<Period, { amount: string; per: string; note: string }> = {
  yearly: {
    amount: `$${price.yearly / 12}`,
    per: "per month",
    note: `$${price.yearly} per year, billed yearly`,
  },
  monthly: {
    amount: `$${price.monthly}`,
    per: "per month",
    note: `Billed monthly, or $${price.yearly} per year`,
  },
};

/** The period the page renders first, and the one the switch starts on. */
export const defaultPeriod: Period = "yearly";

/** The pricing section's Monthly/Yearly switch: swaps the hosted plan's price. */
export function initBilling() {
  const group = document.querySelector<HTMLElement>("[data-billing]");
  if (!group) return;
  const buttons = group.querySelectorAll<HTMLButtonElement>("button[data-period]");
  for (const button of buttons) {
    button.addEventListener("click", () => {
      const period: Period = button.dataset.period === "yearly" ? "yearly" : "monthly";
      for (const b of buttons) b.setAttribute("aria-pressed", String(b === button));
      for (const key of ["amount", "per", "note"] as const) {
        const el = document.querySelector(`[data-price="${key}"]`);
        if (el) el.textContent = billingText[period][key];
      }
    });
  }
}
