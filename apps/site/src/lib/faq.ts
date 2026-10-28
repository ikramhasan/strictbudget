import { price } from "./site";

export const faq = [
  {
    q: "What does strictbudget cost?",
    a: `Hosted is $${price.monthly} a month or $${price.yearly} a year, with every feature included. The self hosted version is free and open source, and it is the same app.`,
  },
  {
    q: "What is zero based budgeting?",
    a: "You give every dollar of income a job by assigning it to a category before you spend it. When Ready to Assign reads $0.00, all of your money has a plan.",
  },
  {
    q: "Can I share a budget with my partner?",
    a: "Yes. Invite up to five people as editors or read only viewers. Everyone sees changes live, and the history shows who made each one.",
  },
  {
    q: "Does it connect to my bank?",
    a: "Not yet. Import bank files in CSV, OFX, QFX or QIF, and duplicates are matched for you.",
  },
  {
    q: "How does it handle other currencies?",
    a: "Each account keeps its own currency. Its activity converts into your budget's currency at daily market rates, which you can override per budget.",
  },
  {
    q: "Can I bring my history from another app?",
    a: "Most likely. Import accepts budget exports from popular budgeting apps as well as bank files.",
  },
  {
    q: "Can I take my data with me?",
    a: "Anytime. Download a full JSON backup or a CSV export, and restore the backup on a self hosted server.",
  },
  {
    q: "Is there a mobile app?",
    a: "Not yet. strictbudget is a responsive web app that works in your phone's browser.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes. Cancel from your account settings and download a full backup before you go.",
  },
];
