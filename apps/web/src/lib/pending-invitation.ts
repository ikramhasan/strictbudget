/**
 * An invitation link opened before signing in. Its token is kept in this browser so that after
 * signing in, or signing up and confirming the address (often in another tab), "/" brings the
 * person back to the invitation instead of their own budgets.
 */
const KEY = "strictbudget:pending-invitation";

export function rememberInvitation(token: string) {
  try {
    localStorage.setItem(KEY, token);
  } catch {
    // Storage can be blocked; the emailed link still works when opened again.
  }
}

export function pendingInvitation(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function forgetInvitation() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clean up.
  }
}
