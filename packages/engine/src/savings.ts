/**
 * Whether a category or group name reads like savings ("Emergency fund", "💰 Savings", "Roth IRA",
 * "Investments"), to suggest marking it as a savings category. Whole words only, so "Emergency
 * Radio", "Save the Dates" or "Retirement Hobbies" don't match.
 */
export function looksLikeSavings(name: string): boolean {
  return SAVINGS_NAME.test(name);
}

const SAVINGS_NAME =
  /\b(savings?|emergency (fund|savings)|rainy day|nest egg|invest(ing|ments?)|retirement (fund|savings|account)|401\(?k\)?|roth|ira|pension|isa)\b/i;
