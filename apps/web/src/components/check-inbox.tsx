import { Button } from "@strictbudget/ui/components/button";
import { FieldDescription, FieldError } from "@strictbudget/ui/components/field";
import { Spinner } from "@strictbudget/ui/components/spinner";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-errors";

export const RESEND_COOLDOWN_SECONDS = 60;

export function CheckInbox({ email }: { email: string }) {
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function resend() {
    setPending(true);
    setMessage(null);
    const { error } = await authClient.sendVerificationEmail({ email });
    setPending(false);
    setCooldown(RESEND_COOLDOWN_SECONDS);
    setMessage(
      error
        ? { error: true, text: authErrorMessage(error, "Couldn't send the email. Try again.") }
        : { error: false, text: "Sent. Check your inbox (and spam folder)." },
    );
  }

  return (
    <div className="grid gap-4 text-sm">
      <p>
        We've sent a confirmation link to <span className="font-medium break-all">{email}</span>.
        Open it to confirm your address, then sign in.
      </p>
      <p className="text-muted-foreground">The link expires in 1 hour.</p>
      {message &&
        (message.error ? (
          <FieldError>{message.text}</FieldError>
        ) : (
          <FieldDescription role="status">{message.text}</FieldDescription>
        ))}
      <Button variant="outline" onClick={resend} disabled={pending || cooldown > 0}>
        {pending && <Spinner />}
        {cooldown > 0 ? `Resend email (${cooldown}s)` : "Resend email"}
      </Button>
    </div>
  );
}
