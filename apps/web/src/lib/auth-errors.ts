export interface AuthClientError {
  code?: string;
  message?: string;
  status: number;
}

const MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "That email and password don't match.",
  EMAIL_NOT_VERIFIED:
    "Confirm your email address first. We've sent a new confirmation link to your inbox.",
  TOKEN_EXPIRED: "This link has expired. Links work for 1 hour: ask for a new one.",
  INVALID_TOKEN: "This link isn't valid. Check that you opened the whole link from the email.",
  USER_NOT_FOUND: "This link isn't valid any more.",
  INVALID_USER: "This link belongs to a different account. Sign out and open it again.",
  // Sign-up on a server that sends no email (with email, it answers the same for any address).
  USER_ALREADY_EXISTS: "An account already uses that address. Sign in instead.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "An account already uses that address. Sign in instead.",
  PASSWORD_TOO_SHORT: "Use at least 8 characters.",
  PASSWORD_TOO_LONG: "Use at most 128 characters.",
  PASSWORD_COMPROMISED:
    "That password has appeared in a data breach. Choose one you haven't used anywhere else.",
  INVALID_PASSWORD: "That password isn't right.",
  EMAIL_TAKEN:
    "Someone has signed up with that address since you asked for the change, so your email wasn't changed. Your current address still works; you can try another one in Settings.",
  SIGN_IN_REQUIRED:
    "Sign in to your account in this browser, then open the link from the email again.",
};

export function authErrorMessage(error: AuthClientError, fallback: string): string {
  if (error.status === 429) return "Too many attempts. Wait a minute and try again.";
  return (error.code && MESSAGES[error.code]) || fallback;
}
