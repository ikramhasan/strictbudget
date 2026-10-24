import { html } from "hono/html";
import {
  button,
  frame,
  type Html,
  iconBadge,
  mutedText,
  paragraph,
  section,
  stack,
  strong,
  textLink,
} from "./layout";
import type { EmailKind, EmailMessage } from "./sender";

/**
 * Auth and sharing emails. They carry no user-entered text except email addresses, so a display name can't be
 * used to slip a phishing line into a message we sign. Interpolations go through hono's `html`,
 * which escapes them.
 *
 * Links point at the web app with the token in the URL fragment (`#token=`). Fragments aren't sent
 * to servers, so the token stays out of access logs and Referer headers, and nothing happens until
 * the person clicks the button on that page: a mail scanner that opens the link changes nothing.
 */

/** Text with parts shown in bold (email addresses), for the HTML and the plain-text version. */
type Rich = (string | { strong: string })[];

const richHtml = (parts: Rich) =>
  html`${parts.map((p) => (typeof p === "string" ? p : strong(p.strong)))}`;
const richText = (parts: Rich) => parts.map((p) => (typeof p === "string" ? p : p.strong)).join("");

const FOOTERS = {
  security:
    "You're getting this because of activity on the strictbudget account for this address. We never ask for your password by email.",
  sharing: "You're getting this because someone invited this address to a strictbudget budget.",
};

interface Content {
  subject: string;
  title: string;
  /** `/email/icon-<icon>.png`. */
  icon: "mail" | "key" | "shield" | "alert" | "users" | "signin";
  intro: Rich;
  notice?: string;
  action: { label: string; url: string };
  /** A notice rather than a request: the button looks secondary. */
  quiet?: boolean;
  secondary?: { label: string; url: string };
  /** Short facts under the button, e.g. "Expires in 1 hour". */
  facts?: string[];
  outro?: string;
  footer: keyof typeof FOOTERS;
}

function render(kind: EmailKind, to: string, webOrigin: string, c: Content) {
  const facts = c.facts?.join(" · ");
  const text = [
    c.title,
    richText(c.intro),
    c.notice,
    `${c.action.label}: ${c.action.url}`,
    c.secondary ? `${c.secondary.label}: ${c.secondary.url}` : null,
    facts,
    c.outro,
  ]
    .filter(Boolean)
    .join("\n\n");
  const body: Html = stack(
    [
      iconBadge(webOrigin, c.icon, c.icon === "alert"),
      html`<h1 class="ec-strong" style="margin:0;font-size:22px;line-height:1.25;font-weight:600;letter-spacing:-0.01em;color:#1a1a1a">${c.title}</h1>`,
      paragraph(richHtml(c.intro)),
      c.notice && paragraph(c.notice),
      html`${button(c.action.label, c.action.url, { quiet: c.quiet })}${
        c.secondary
          ? html`<span style="display:inline-block;padding:10px 8px">${textLink(c.secondary.label, c.secondary.url)}</span>`
          : ""
      }`,
      facts && mutedText(facts),
      html`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td class="ec-muted ec-muted-fg" style="background:#f5f5f5;border-radius:8px;padding:10px 12px;font-size:12px;line-height:1.55;color:#6e6e6e">Button not working? Paste this link into your browser:<br><a href="${c.action.url}" class="ec-link" style="color:#3e6ae1;text-decoration:none;word-break:break-all">${c.action.url}</a></td></tr></table>`,
      c.outro && mutedText(c.outro),
    ],
    16,
  );
  return {
    kind,
    to,
    subject: c.subject,
    text,
    html: frame({
      webOrigin,
      subject: c.subject,
      sections: [section(body, { first: true, top: 4 })],
      footer: [html`${FOOTERS[c.footer]}`, html`Sent to ${to}`, html`strictbudget`],
    }),
  } satisfies EmailMessage;
}

/** A web app link with its parameters in the fragment. */
export const link = (webOrigin: string, path: string, params: Record<string, string>) =>
  `${webOrigin}${path}#${new URLSearchParams(params).toString()}`;

const IGNORE = "If you didn't ask for this, you can ignore this email.";
const HOUR = "Expires in 1 hour";

export const emails = {
  verifyEmail: (to: string, webOrigin: string, token: string) =>
    render("verify-email", to, webOrigin, {
      subject: "Confirm your email address",
      title: "Confirm your email",
      icon: "mail",
      intro: ["Confirm this email address to finish setting up your strictbudget account."],
      action: { label: "Confirm email", url: link(webOrigin, "/verify-email", { token }) },
      facts: [HOUR],
      outro: IGNORE,
      footer: "security",
    }),

  /** To the current address: approve moving the account to `newEmail`. */
  changeEmailConfirm: (to: string, newEmail: string, webOrigin: string, token: string) =>
    render("change-email-confirm", to, webOrigin, {
      subject: "Approve your email change",
      title: "Approve your email change",
      icon: "alert",
      intro: [
        "Someone signed in to your strictbudget account asked to change its email address to ",
        { strong: newEmail },
        ". Approve the change and we'll send a confirmation link to that address.",
      ],
      action: {
        label: "Approve change",
        url: link(webOrigin, "/verify-email", { token, step: "approve" }),
      },
      facts: [HOUR],
      outro:
        "If this wasn't you, don't approve it: change your password, and sign out your other devices in your account settings.",
      footer: "security",
    }),

  /** To the new address, after the old one approved. */
  changeEmailVerify: (to: string, webOrigin: string, token: string) =>
    render("change-email-verify", to, webOrigin, {
      subject: "Confirm your new email address",
      title: "Confirm your new email",
      icon: "mail",
      intro: [
        "Confirm this address to make it the email for your strictbudget account. Open the link in a browser where you're signed in to strictbudget.",
      ],
      action: {
        label: "Confirm new email",
        url: link(webOrigin, "/verify-email", { token, step: "change" }),
      },
      facts: [HOUR],
      outro: IGNORE,
      footer: "security",
    }),

  resetPassword: (to: string, webOrigin: string, token: string) =>
    render("reset-password", to, webOrigin, {
      subject: "Reset your password",
      title: "Reset your password",
      icon: "key",
      intro: ["Someone asked to reset the password for your strictbudget account."],
      action: {
        label: "Choose a new password",
        url: link(webOrigin, "/reset-password", { token }),
      },
      facts: [HOUR, "works once"],
      outro: `${IGNORE} Your password won't change.`,
      footer: "security",
    }),

  /** Someone tried to sign up with an address that already has an account. */
  existingAccount: (to: string, webOrigin: string) =>
    render("existing-account", to, webOrigin, {
      subject: "You already have a strictbudget account",
      title: "You already have an account",
      icon: "signin",
      intro: [
        "Someone tried to create a strictbudget account with this email address, but it already has one. If that was you, sign in instead, or reset your password if you've forgotten it.",
      ],
      action: { label: "Sign in", url: `${webOrigin}/sign-in` },
      secondary: { label: "Reset password", url: `${webOrigin}/forgot-password` },
      outro: IGNORE,
      footer: "security",
    }),

  passwordChanged: (to: string, webOrigin: string) =>
    render("password-changed", to, webOrigin, {
      subject: "Your password was changed",
      title: "Your password was changed",
      icon: "shield",
      intro: ["The password for your strictbudget account was just changed."],
      notice: "If this was you, there's nothing to do. If it wasn't, reset your password now.",
      action: { label: "Reset your password", url: `${webOrigin}/forgot-password` },
      quiet: true,
      footer: "security",
    }),

  /**
   * An invitation to share a budget. Only the inviter's address is named: budget and display names
   * are free text, so they're shown on the invitation page after the link is opened.
   */
  budgetInvitation: (to: string, inviterEmail: string, webOrigin: string, token: string) =>
    render("budget-invitation", to, webOrigin, {
      subject: "You're invited to share a budget on strictbudget",
      title: "You're invited to share a budget",
      icon: "users",
      intro: [
        { strong: inviterEmail },
        " invited you to share a budget on strictbudget. You'll be able to see and edit its accounts, transactions and plan.",
      ],
      action: { label: "View invitation", url: link(webOrigin, "/invitation", { token }) },
      facts: ["Expires in 14 days"],
      outro: "If you don't know who sent it, you can ignore this email.",
      footer: "sharing",
    }),

  /** Three days before a pending invitation expires. Replaces the earlier link. */
  invitationReminder: (to: string, inviterEmail: string, webOrigin: string, token: string) =>
    render("budget-invitation-reminder", to, webOrigin, {
      subject: "Your strictbudget invitation expires soon",
      title: "Your invitation expires in 3 days",
      icon: "users",
      intro: [
        { strong: inviterEmail },
        " invited you to share a budget on strictbudget. The invitation expires in 3 days.",
      ],
      action: { label: "View invitation", url: link(webOrigin, "/invitation", { token }) },
      facts: ["Expires in 3 days", "replaces the earlier link"],
      outro:
        "This link replaces the one in the first email. If you don't know who sent it, you can ignore this email.",
      footer: "sharing",
    }),
};
