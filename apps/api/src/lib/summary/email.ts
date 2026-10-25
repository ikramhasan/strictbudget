import { addMonths, type BudgetFormatSettings, formatAmount } from "@strictbudget/engine";
import { html } from "hono/html";
import {
  button,
  C,
  frame,
  type Html,
  mutedText,
  paragraph,
  section,
  stack,
  textLink,
} from "../email/layout";
import type { EmailMessage } from "../email/sender";
import type { SummaryOverview } from "./ai";
import type { MonthlySummary } from "./data";
import { dayAndMonth, monthAndYear, monthName, shortMonthName } from "./format";

/**
 * The monthly summary email, one per budget per member. Unlike the auth emails it
 * shows names from the budget (its own, categories, payees): they come from a budget the
 * recipient is on, and like every interpolation they're escaped. Sections with nothing to say
 * are left out.
 */
export interface SummaryEmailInput {
  to: string;
  webOrigin: string;
  budget: BudgetFormatSettings & { id: string; name: string };
  summary: MonthlySummary;
  overview: SummaryOverview | null;
  /** The web page that turns monthly summaries off (a click there, never on opening the link). */
  unsubscribeUrl: string;
  /** RFC 8058 one-click unsubscribe, for mail clients' own button (`List-Unsubscribe`). */
  oneClickUrl: string;
}

const MINUS = "−";

/** Up to this many targets get a segment each in the funded strip; more share one bar. */
const MAX_SEGMENTS = 24;

function h2(text: string) {
  return html`<h2 class="ec-strong" style="margin:0;font-size:15px;line-height:1.4;font-weight:600;color:${C.strong}">${text}</h2>`;
}

function headRow(title: string, right?: Html) {
  return html`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="vertical-align:baseline">${h2(title)}</td>${
    right
      ? html`<td align="right" style="vertical-align:baseline;white-space:nowrap;font-size:13px">${right}</td>`
      : ""
  }</tr></table>`;
}

interface Row {
  name: Html | string;
  meta?: string;
  amount: string;
  tone?: "up" | "down";
  /** A bar under the row, 0–100. */
  bar?: number;
  dot?: "destructive" | "warn";
}

function rows(items: Row[]) {
  return html`<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items.map(
    (r, i) => {
      const rule = i === 0 ? "" : `border-top:1px solid ${C.border};`;
      const pad = i === 0 ? "padding:0 0 10px" : "padding:10px 0";
      const color = r.tone === "up" ? C.success : r.tone === "down" ? C.destructive : C.strong;
      const toneClass = r.tone === "up" ? "ec-up" : r.tone === "down" ? "ec-down" : "ec-strong";
      const dot = r.dot
        ? html`<span style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:8px;vertical-align:1px;background:${r.dot === "warn" ? C.warn : C.destructive}"></span>`
        : "";
      return html`<tr><td class="ec-line" style="${rule}${pad}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td class="ec-fg" style="font-size:14px;line-height:1.45;color:${C.fg};vertical-align:baseline">${dot}${r.name}${
        r.meta
          ? html`<br><span class="ec-muted-fg" style="font-size:12px;color:${C.mutedFg}">${r.meta}</span>`
          : ""
      }</td>
<td align="right" class="${toneClass}" style="font-size:14px;font-weight:500;color:${color};white-space:nowrap;vertical-align:baseline;padding-left:12px;font-variant-numeric:tabular-nums">${r.amount}</td>
</tr>${
        r.bar === undefined
          ? ""
          : html`<tr><td colspan="2" style="padding-top:6px">${bar(r.bar)}</td></tr>`
      }</table></td></tr>`;
    },
  )}</table>`;
}

function bar(percent: number) {
  const width = Math.max(1, Math.min(100, Math.round(percent * 10) / 10));
  return html`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td class="ec-bar" style="background:${C.muted};border-radius:999px;height:4px;font-size:0;line-height:0"><table role="presentation" width="${width}%" cellpadding="0" cellspacing="0"><tr><td style="background:${C.primary};border-radius:999px;height:4px;font-size:0;line-height:0">&nbsp;</td></tr></table></td></tr></table>`;
}

/** One segment per target: funded green, partly funded amber, the rest grey. */
function targetStrip(t: MonthlySummary["targets"]) {
  const shortNone = t.total - t.funded - t.partly;
  if (t.total > MAX_SEGMENTS) return bar((t.funded / t.total) * 100);
  const cells = [
    ...Array<string>(t.funded).fill(C.success),
    ...Array<string>(t.partly).fill(C.warn),
    ...Array<string>(shortNone).fill(C.muted),
  ];
  return html`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cells.map(
    (color, i) =>
      html`${i > 0 ? html`<td width="4" style="width:4px;font-size:0;line-height:0">&nbsp;</td>` : ""}<td class="${color === C.muted ? "ec-bar" : ""}" style="background:${color};border-radius:999px;height:4px;font-size:0;line-height:0">&nbsp;</td>`,
  )}</tr></table>`;
}

/** An upcoming transaction's amount, with its currency's code when it isn't the budget's. */
export function upcomingMoney(
  u: { amount: bigint; currency: MonthlySummary["currency"] },
  budgetCurrency: MonthlySummary["currency"],
  settings: BudgetFormatSettings,
) {
  const amount = formatAmount({ amount: u.amount, currency: u.currency }, settings);
  return u.currency === budgetCurrency ? amount : `${amount} ${u.currency}`;
}

export function monthlySummaryEmail(input: SummaryEmailInput): EmailMessage {
  const { to, webOrigin, budget, summary: s, overview } = input;
  // A typographic minus, as the stats' deltas use.
  const money = (amount: bigint) =>
    formatAmount({ amount, currency: s.currency }, budget).replace(/^-/, MINUS);
  const signed = (amount: bigint) =>
    `${amount < 0n ? MINUS : "+"}${money(amount < 0n ? -amount : amount)}`;
  const upcomingAmount = (u: { amount: bigint; currency: MonthlySummary["currency"] }) =>
    upcomingMoney(u, s.currency, budget);
  const foreign = s.upcoming.items.some((u) => u.currency !== s.currency);
  const month = monthName(s.month);
  const next = addMonths(s.month, 1);
  const nextName = monthName(next);
  const lastShort = shortMonthName(addMonths(s.month, -1));
  const budgetUrl = (m: string) => `${webOrigin}/budgets/${budget.id}?month=${m}`;

  const overspentTotal = s.overspent.reduce((sum, o) => sum - o.available, 0n);
  const headline =
    overspentTotal > 0n
      ? `You spent ${money(s.spent)}, ${money(overspentTotal)} more than you assigned.`
      : s.readyToAssign > 0n
        ? `You spent ${money(s.spent)}, and ${money(s.readyToAssign)} is still waiting for a job.`
        : `You spent ${money(s.spent)} and every cent had a job.`;
  // The budget's name tells apart the emails of someone on several budgets.
  const subject = `Your ${month} in strictbudget: ${budget.name}`;
  const lede = `Here's how ${month} went, and what's coming up in ${nextName}.`;

  // Key numbers. Spending less than last month is good news; earning less isn't.
  const delta = (now: bigint, before: bigint | undefined, lessIsGood: boolean) => {
    if (before === undefined || now === before) return null;
    const good = now < before === lessIsGood;
    return html`<span class="${good ? "ec-up" : "ec-down"}" style="color:${good ? C.success : C.destructive}">${signed(now - before)}</span> vs ${lastShort}`;
  };
  const share = s.income > 0n ? `${(s.assigned * 100n) / s.income}% of income` : null;
  const stats: { label: string; value: string; note: Html | string | null }[] = [
    { label: "Income", value: money(s.income), note: delta(s.income, s.previous?.income, false) },
    { label: "Spent", value: money(s.spent), note: delta(s.spent, s.previous?.spent, true) },
    { label: "Assigned", value: money(s.assigned), note: share },
  ];
  const statCells = stats.map(
    (st, i) =>
      html`<td class="ec-stat ec-line${i > 0 ? " ec-stat-next" : ""}" width="33%" style="width:33%;padding:14px 16px;vertical-align:top;${i > 0 ? `border-left:1px solid ${C.border};` : ""}">
<div class="ec-muted-fg" style="font-size:12px;color:${C.mutedFg}">${st.label}</div>
<div class="ec-strong" style="font-size:20px;font-weight:600;letter-spacing:-0.01em;color:${C.strong};padding-top:4px;font-variant-numeric:tabular-nums">${st.value}</div>
${st.note ? html`<div class="ec-muted-fg" style="font-size:12px;color:${C.mutedFg};padding-top:4px">${st.note}</div>` : ""}
</td>`,
  );
  const negative = s.readyToAssign < 0n;
  const rta = html`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td class="ec-muted" style="background:${C.muted};border-radius:10px;padding:12px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td class="ec-fg" style="font-size:14px;color:${C.fg}">Ready to Assign at the end of ${month}</td>
<td align="right"><span class="${negative ? "ec-pill-down" : "ec-pill-up"}" style="display:inline-block;font-size:13px;font-weight:500;padding:2px 10px;border-radius:999px;white-space:nowrap;background:${negative ? C.destructiveTint : C.successTint};color:${negative ? C.destructive : C.success};font-variant-numeric:tabular-nums">${money(s.readyToAssign)}</span></td>
</tr></table></td></tr></table>`;

  const header = stack([
    html`<div class="ec-muted-fg" style="font-size:12px;letter-spacing:0.04em;text-transform:uppercase;font-weight:500;color:${C.mutedFg};padding-bottom:6px">${budget.name} · ${monthAndYear(s.month)}</div>
<h1 class="ec-strong" style="margin:0;font-size:24px;line-height:1.25;font-weight:600;letter-spacing:-0.01em;color:${C.strong}">${headline}</h1>
<p class="ec-muted-fg" style="margin:6px 0 0;font-size:14px;line-height:1.6;color:${C.mutedFg}">${lede}</p>`,
    html`<table role="presentation" class="ec-line" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.border};border-radius:10px;border-collapse:separate"><tr>${statCells}</tr></table>`,
    rta,
  ]);

  const sections: Html[] = [section(header, { first: true, top: 4 })];

  if (overview) {
    sections.push(
      section(
        html`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td class="ec-tint" style="background:${C.tint};border-radius:10px;padding:16px 18px">${stack(
          [
            html`<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="padding-right:6px;vertical-align:middle"><img src="${webOrigin}/email/icon-sparkle.png" width="14" height="14" alt="" style="display:block;border:0"></td><td class="ec-link" style="font-size:12px;font-weight:500;color:${C.primary};vertical-align:middle">Overview by your AI assistant</td></tr></table>`,
            paragraph(overview.overview),
            overview.points.length > 0 &&
              html`<ul class="ec-fg" style="margin:0;padding-left:18px;font-size:14px;line-height:1.55;color:${C.fg}">${overview.points.map(
                (p, i) =>
                  html`<li style="${i < overview.points.length - 1 ? "padding-bottom:6px" : ""}">${p}</li>`,
              )}</ul>`,
            mutedText(
              "Written from this month's budget data. AI can make mistakes, so check the numbers in strictbudget.",
              12,
            ),
          ],
          10,
        )}</td></tr></table>`,
      ),
    );
  }

  if (s.groups.length > 0) {
    const most = s.groups[0]?.spent ?? 1n;
    sections.push(
      section(
        stack([
          headRow(
            "Spending by group",
            textLink(
              "Open report",
              `${webOrigin}/budgets/${budget.id}/reports/spending-breakdown`,
              13,
            ),
          ),
          rows(
            s.groups.map((g) => ({
              name: g.name,
              amount: money(g.spent),
              // Basis points, so the bar's width needs no float until the end.
              bar: Number((g.spent * 10_000n) / (most > 0n ? most : 1n)) / 100,
            })),
          ),
        ]),
      ),
    );
  }

  if (s.overspent.length > 0) {
    const cash = s.overspent.some((o) => !o.credit);
    sections.push(
      section(
        stack([
          headRow("Overspent categories", textLink("Cover overspending", budgetUrl(s.month), 13)),
          mutedText(
            `These categories ended ${month} below zero.${cash ? ` Cash overspending comes out of ${nextName}'s Ready to Assign.` : ""}`,
            14,
          ),
          rows(
            s.overspent.map((o) => ({
              name: o.name,
              dot: o.credit ? "warn" : "destructive",
              meta: `${o.credit ? "Credit card · assigned" : "Assigned"} ${money(o.assigned)} · spent ${money(o.spent)}`,
              amount: `${MINUS}${money(-o.available)}`,
              tone: "down",
            })),
          ),
        ]),
      ),
    );
  }

  if (s.targets.total > 0) {
    const t = s.targets;
    sections.push(
      section(
        stack([
          headRow("Targets", mutedText(`${t.funded} of ${t.total} funded`)),
          targetStrip(t),
          t.short.length > 0 &&
            rows(
              t.short.map((x) => ({
                name: x.name,
                meta: `${money(x.funded)} of ${money(x.needed)}${x.dueDate ? ` · due ${dayAndMonth(x.dueDate)}` : ` this month`}`,
                amount: `${money(x.needed - x.funded)} to go`,
              })),
            ),
        ]),
      ),
    );
  }

  if (s.largest.length > 0) {
    sections.push(
      section(
        stack([
          h2("Largest transactions"),
          rows(
            s.largest.map((l) => ({
              name: l.payee ?? "No payee",
              meta: [dayAndMonth(l.date), l.category, l.account].filter(Boolean).join(" · "),
              amount: money(l.amount),
            })),
          ),
        ]),
      ),
    );
  }

  if (s.upcoming.count > 0) {
    sections.push(
      section(
        stack([
          headRow(`Coming up in ${nextName}`, mutedText(`${s.upcoming.count} scheduled`)),
          rows(
            s.upcoming.items.map((u) => {
              const amount = upcomingAmount({
                ...u,
                amount: u.amount < 0n ? -u.amount : u.amount,
              });
              return {
                name: u.payee ?? "No payee",
                meta: [dayAndMonth(u.date), u.category].filter(Boolean).join(" · "),
                amount: u.amount > 0n ? `+${amount}` : amount,
                tone: u.amount > 0n ? ("up" as const) : undefined,
              };
            }),
          ),
        ]),
      ),
    );
  }

  sections.push(
    section(
      stack([
        paragraph(
          `${nextName}'s plan is ready for you. Assign the money you have now and give every cent a job.`,
        ),
        button(`Plan ${nextName}`, budgetUrl(next)),
      ]),
    ),
  );

  const settingsUrl = `${webOrigin}/account?tab=notifications#settings-notifications`;
  const footer = [
    html`You get this summary on the 1st of each month for the budgets you're a member of. Amounts are in ${s.currency}, the budget's currency${foreign ? ", unless another currency is named" : ""}.`,
    html`<a href="${settingsUrl}" class="ec-muted-fg" style="color:${C.mutedFg};text-decoration:underline">Email settings</a> · <a href="${input.unsubscribeUrl}" class="ec-muted-fg" style="color:${C.mutedFg};text-decoration:underline">Unsubscribe from monthly summaries</a>`,
    html`strictbudget`,
  ];

  const text = [
    `${budget.name} · ${monthAndYear(s.month)}`,
    headline,
    lede,
    [
      `Income: ${money(s.income)}`,
      `Spent: ${money(s.spent)}`,
      `Assigned: ${money(s.assigned)}`,
      `Ready to Assign at the end of ${month}: ${money(s.readyToAssign)}`,
    ].join("\n"),
    overview && [overview.overview, ...overview.points.map((p) => `- ${p}`)].join("\n"),
    s.groups.length > 0 &&
      ["Spending by group", ...s.groups.map((g) => `- ${g.name}: ${money(g.spent)}`)].join("\n"),
    s.overspent.length > 0 &&
      [
        "Overspent categories",
        ...s.overspent.map((o) => `- ${o.name}: ${MINUS}${money(-o.available)}`),
      ].join("\n"),
    s.targets.total > 0 &&
      [
        `Targets: ${s.targets.funded} of ${s.targets.total} funded`,
        ...s.targets.short.map((x) => `- ${x.name}: ${money(x.needed - x.funded)} to go`),
      ].join("\n"),
    s.largest.length > 0 &&
      [
        "Largest transactions",
        ...s.largest.map(
          (l) => `- ${dayAndMonth(l.date)} ${l.payee ?? "No payee"}: ${money(l.amount)}`,
        ),
      ].join("\n"),
    s.upcoming.count > 0 &&
      [
        `Coming up in ${nextName} (${s.upcoming.count} scheduled)`,
        ...s.upcoming.items.map(
          (u) => `- ${dayAndMonth(u.date)} ${u.payee ?? "No payee"}: ${upcomingAmount(u)}`,
        ),
      ].join("\n"),
    `Plan ${nextName}: ${budgetUrl(next)}`,
    `Email settings: ${settingsUrl}\nUnsubscribe from monthly summaries: ${input.unsubscribeUrl}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    kind: "monthly-summary",
    to,
    subject,
    text,
    html: frame({ webOrigin, subject, preheader: headline, sections, footer }),
    headers: {
      "List-Unsubscribe": `<${input.oneClickUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}
