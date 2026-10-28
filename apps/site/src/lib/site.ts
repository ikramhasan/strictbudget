/** The hosted app (apps/web on Railway, see .railway/railway.ts). */
export const APP_URL = "https://web.strictbudget.app";
export const REPO_URL = "https://github.com/ikramhasan/strictbudget";

export const links = {
  signUp: `${APP_URL}/sign-up`,
  signIn: `${APP_URL}/sign-in`,
  apiReference: `${APP_URL}/docs`,
  github: REPO_URL,
  selfHosting: `${REPO_URL}#self-hosting`,
  changelog: `${REPO_URL}/releases`,
  discussions: `${REPO_URL}/discussions`,
};

export const price = { monthly: 8, yearly: 60 };

export const site = {
  name: "strictbudget",
  title: "strictbudget: zero based budgeting in every currency",
  description:
    "Give every cent a job before you spend it. Share a budget with up to five people, track 150 currencies and keep your data. $8 a month, or self host it free.",
  riskNote: `$${price.monthly} a month. Cancel anytime and keep every transaction.`,
};

/** In-page sections the navigation links to, on the home page. */
export const navLinks = [
  { label: "Features", href: "/#features" },
  { label: "How it works", href: "/#how-it-works" },
  { label: "Pricing", href: "/#pricing" },
  { label: "FAQ", href: "/#faq" },
  { label: "Blog", href: "/blog" },
];
