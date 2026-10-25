import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";

/**
 * The frame every email shares, after the web app's design (`packages/ui` globals.css): a
 * 600px card on a light ground, the brand mark at the top, a muted footer. Email clients only
 * reliably honour tables and inline styles, so the light theme is inline and the dark theme
 * overrides it from a `<style>` block (Apple Mail, iOS Mail, Outlook for Mac; Gmail keeps light).
 * Images are PNGs the web app serves under `/email/` (SVG doesn't render in Gmail or Outlook).
 */

export type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

/** The design tokens, light. `C.x` is a colour; the dark values are in `DARK_CSS`. */
export const C = {
  canvas: "#f6f6f4",
  card: "#ffffff",
  fg: "#333333",
  strong: "#1a1a1a",
  muted: "#f5f5f5",
  mutedFg: "#6e6e6e",
  border: "#ebebeb",
  primary: "#3e6ae1",
  primaryFg: "#ffffff",
  success: "#0a772a",
  destructive: "#d42f2f",
  warn: "#c2761b",
  tint: "#eef2fc",
  alertTint: "#fbeaea",
  successTint: "#e3f0e7",
  destructiveTint: "#f9e2e2",
} as const;

export const FONT =
  "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/**
 * Classes the dark theme and the narrow layout restyle. Every element that carries a colour
 * carries its class, so dark mode never leaves a light patch behind.
 */
const DARK_CSS = `
.ec-canvas{background:#111111!important}
.ec-card{background:#1c1c1c!important;border-color:#2e2e2e!important}
.ec-fg{color:#ececec!important}
.ec-strong{color:#f5f5f5!important}
.ec-muted-fg{color:#9a9a9a!important}
.ec-muted{background:#242424!important}
.ec-line{border-color:#2e2e2e!important}
.ec-link{color:#8aa4ee!important}
.ec-tint{background:#1f2533!important}
.ec-alert-tint{background:#3a2224!important}
.ec-up{color:#3ddc6e!important}
.ec-down{color:#ff6b6b!important}
.ec-warn{color:#e9a84a!important}
.ec-pill-up{background:#183a24!important;color:#3ddc6e!important}
.ec-pill-down{background:#3a2224!important;color:#ff6b6b!important}
.ec-bar{background:#2e2e2e!important}
.ec-quiet{background:#242424!important;color:#f5f5f5!important;border-color:#2e2e2e!important}`;

const NARROW_CSS = `
.ec-pad{padding-left:20px!important;padding-right:20px!important}
.ec-stat{display:block!important;width:auto!important;border-left:0!important}
.ec-stat+.ec-stat,.ec-stat-next{border-top:1px solid #ebebeb!important}`;

const STYLE = `
:root{color-scheme:light dark;supported-color-schemes:light dark}
body{margin:0;padding:0}
a{text-decoration:none}
@media (prefers-color-scheme: dark){${DARK_CSS}}
@media (max-width: 480px){${NARROW_CSS}}`;

function brand(webOrigin: string) {
  return html`<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="padding-right:8px;vertical-align:middle"><img src="${webOrigin}/email/logo.png" width="22" height="22" alt="" style="display:block;border:0"></td>
<td class="ec-strong" style="font-size:15px;font-weight:600;color:${C.strong};vertical-align:middle">strictbudget</td>
</tr></table>`;
}

/** One padded section of the card, with a rule above it unless it's the first. */
export function section(body: Html, { first = false, top = 24 } = {}) {
  const rule = first ? "" : `border-top:1px solid ${C.border};`;
  return html`<tr><td class="ec-pad ec-line" style="${rule}padding:${top}px 32px 24px">${body}</td></tr>`;
}

/** Stacked blocks with a gap between them (email clients ignore CSS gap). */
export function stack(blocks: (Html | null | undefined | false | "")[], gap = 14) {
  const shown = blocks.filter((b): b is Html => Boolean(b));
  return html`<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${shown.map(
    (b, i) =>
      html`<tr><td style="${i === shown.length - 1 ? "" : `padding-bottom:${gap}px`}">${b}</td></tr>`,
  )}</table>`;
}

export function paragraph(body: Html | string, style = "") {
  return html`<p class="ec-fg" style="margin:0;font-size:14px;line-height:1.6;color:${C.fg};${style}">${body}</p>`;
}

export function mutedText(body: Html | string, size = 13) {
  return html`<p class="ec-muted-fg" style="margin:0;font-size:${size}px;line-height:1.6;color:${C.mutedFg}">${body}</p>`;
}

/** Emphasised text inside a paragraph, e.g. an email address. */
export function strong(text: string) {
  return html`<span class="ec-strong" style="font-weight:600;color:${C.strong};word-break:break-all">${text}</span>`;
}

/** The main action. `quiet` is a notice's secondary-looking button. */
export function button(label: string, url: string, { quiet = false } = {}) {
  const style = quiet
    ? `background:${C.muted};color:${C.strong};border:1px solid ${C.border};`
    : `background:${C.primary};color:${C.primaryFg};border:1px solid ${C.primary};`;
  return html`<a href="${url}" class="${quiet ? "ec-quiet" : ""}" style="display:inline-block;${style}text-decoration:none;font-size:14px;font-weight:500;line-height:20px;padding:10px 18px;border-radius:8px">${label}</a>`;
}

export function textLink(label: string, url: string, size = 14) {
  return html`<a href="${url}" class="ec-link" style="color:${C.primary};text-decoration:none;font-size:${size}px">${label}</a>`;
}

/** A small rounded square with an icon (`/email/icon-<name>.png`). */
export function iconBadge(webOrigin: string, icon: string, alert = false) {
  return html`<table role="presentation" cellpadding="0" cellspacing="0"><tr><td class="${alert ? "ec-alert-tint" : "ec-tint"}" width="40" height="40" align="center" style="width:40px;height:40px;border-radius:10px;background:${alert ? C.alertTint : C.tint}"><img src="${webOrigin}/email/icon-${icon}.png" width="20" height="20" alt="" style="display:block;border:0"></td></tr></table>`;
}

export interface FrameInput {
  webOrigin: string;
  subject: string;
  /** Hidden preview text inbox lists show after the subject. */
  preheader?: string;
  /** The card's sections (`section(...)`), the brand row is added above them. */
  sections: Html[];
  footer: Html[];
}

export function frame({ webOrigin, subject, preheader, sections, footer }: FrameInput): string {
  const doc = html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${subject}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap">
<style>${raw(STYLE)}</style>
</head>
<body class="ec-canvas" style="margin:0;padding:0;background:${C.canvas};font-family:${raw(FONT)};-webkit-font-smoothing:antialiased">
${preheader ? html`<div style="display:none;max-height:0;overflow:hidden;opacity:0">${preheader}</div>` : ""}
<table role="presentation" class="ec-canvas" width="100%" cellpadding="0" cellspacing="0" style="background:${C.canvas}"><tr><td align="center" style="padding:24px 12px 48px">
<table role="presentation" class="ec-card" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${C.card};border:1px solid ${C.border};border-radius:12px;border-collapse:separate;overflow:hidden;font-family:${raw(FONT)}">
${section(brand(webOrigin), { first: true })}
${sections}
<tr><td class="ec-pad ec-muted" style="padding:20px 32px 28px;background:${C.muted};border-radius:0 0 12px 12px">${stack(
    footer.map((line) => mutedText(line, 12)),
    8,
  )}</td></tr>
</table>
</td></tr></table>
</body>
</html>`;
  return String(doc);
}
