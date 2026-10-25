import { Button } from "@strictbudget/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@strictbudget/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@strictbudget/ui/components/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@strictbudget/ui/components/field";
import { Input } from "@strictbudget/ui/components/input";
import { Spinner } from "@strictbudget/ui/components/spinner";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import QRCode from "react-qr-code";
import { toast } from "sonner";
import { $api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-errors";
import { apiErrorMessage } from "@/lib/budgets";
import { refreshSession } from "@/lib/session";

/** Turning it on signs out the account's other devices; turning it off asks for a code. */
export function TwoFactorCard() {
  const me = $api.useQuery("get", "/v1/me");
  const [dialog, setDialog] = useState<"setup" | "off" | null>(null);
  const enabled = me.data?.twoFactorEnabled ?? false;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Two-Step Verification</CardTitle>
        <CardDescription>
          Increase your strictbudget login security by adding a second method of login: a code from
          a verification app on your phone.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-4">
        <p className="text-sm">{enabled ? "On" : "Off"}</p>
        {me.data &&
          (enabled ? (
            <Button variant="outline" onClick={() => setDialog("off")}>
              Turn Off
            </Button>
          ) : (
            <Button onClick={() => setDialog("setup")}>Set Up</Button>
          ))}
      </CardContent>
      {dialog === "setup" && <SetUpDialog onClose={() => setDialog(null)} />}
      {dialog === "off" && <TurnOffDialog onClose={() => setDialog(null)} />}
    </Card>
  );
}

type SetUpStep =
  | { step: "password" }
  | { step: "scan"; totpURI: string; backupCode: string }
  | { step: "saved"; backupCode: string };

function SetUpDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const signOutOthers = $api.useMutation("delete", "/v1/me/sessions");
  const [state, setState] = useState<SetUpStep>({ step: "password" });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    setPending(true);
    setError(null);
    const { data, error } = await authClient.twoFactor.enable({ password });
    setPending(false);
    if (error) return setError(authErrorMessage(error, "Couldn't start the set-up. Try again."));
    if (!data || data.method !== "totp") {
      return setError("Couldn't start the set-up. Try again.");
    }
    setState({ step: "scan", totpURI: data.totpURI, backupCode: data.backupCodes[0] ?? "" });
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.step !== "scan") return;
    const code = String(new FormData(event.currentTarget).get("code") ?? "").trim();
    setPending(true);
    setError(null);
    const { error } = await authClient.twoFactor.verifyTotp({ code });
    if (error) {
      setPending(false);
      return setError("That code isn't right. Enter the current one your app shows.");
    }
    // Turning it on replaced this device's session; sign the others out.
    await refreshSession(queryClient);
    try {
      await signOutOthers.mutateAsync({});
    } catch {
      // The setting is on either way; the devices list still shows the other sessions.
    }
    await queryClient.invalidateQueries({ queryKey: ["get", "/v1/me"] });
    await queryClient.invalidateQueries({ queryKey: ["get", "/v1/me/sessions"] });
    setPending(false);
    setState({ step: "saved", backupCode: state.backupCode });
  }

  const secret = state.step === "scan" ? new URL(state.totpURI).searchParams.get("secret") : null;

  return (
    <Dialog open onOpenChange={(open) => !open && state.step !== "scan" && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {state.step === "saved" ? "Save Your Backup Code" : "Set Up a Verification App"}
          </DialogTitle>
          <DialogDescription>
            {state.step === "password"
              ? "Confirm your password to begin. You'll need a verification app such as Authy, Google Authenticator or a password manager."
              : state.step === "scan"
                ? "Open your verification app and add strictbudget as a new account by scanning the QR code, then enter the 6-digit code it shows."
                : "Two-step verification is on, and your other devices were signed out. Keep this emergency backup code somewhere safe: it gets you back in if you lose your phone, and it works once."}
          </DialogDescription>
        </DialogHeader>

        {state.step === "password" && (
          <form onSubmit={start} className="grid gap-4">
            <Field>
              <FieldLabel htmlFor="tf-password">Password</FieldLabel>
              <Input
                id="tf-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                autoFocus
              />
            </Field>
            {error && <FieldError>{error}</FieldError>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Spinner />} Next
              </Button>
            </DialogFooter>
          </form>
        )}

        {state.step === "scan" && (
          <form onSubmit={confirm} className="grid gap-4">
            <div className="mx-auto rounded-lg bg-white p-3">
              <QRCode
                value={state.totpURI}
                size={168}
                aria-label="QR code for your verification app"
              />
            </div>
            <Field>
              <FieldLabel htmlFor="tf-key">Can't scan it? Enter the key manually.</FieldLabel>
              <div className="flex gap-2">
                <Input id="tf-key" readOnly value={secret ?? ""} className="font-mono" />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard.writeText(secret ?? "");
                    toast.success("Key copied");
                  }}
                >
                  Copy
                </Button>
              </div>
            </Field>
            <Field>
              <FieldLabel htmlFor="tf-code">6-Digit Code</FieldLabel>
              <Input
                id="tf-code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                required
                autoFocus
              />
            </Field>
            {error && <FieldError>{error}</FieldError>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Spinner />} Turn On
              </Button>
            </DialogFooter>
          </form>
        )}

        {state.step === "saved" && (
          <div className="grid gap-4">
            <div className="flex gap-2">
              <Input
                readOnly
                value={state.backupCode}
                aria-label="Emergency backup code"
                className="font-mono"
              />
              <Button
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(state.backupCode);
                  toast.success("Backup code copied");
                }}
              >
                Copy
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TurnOffDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const disable = $api.useMutation("post", "/v1/me/two-factor/disable");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code") ?? "").trim();
    setError(null);
    try {
      await disable.mutateAsync({ body: { code } });
    } catch (e) {
      return setError(apiErrorMessage(e, "Couldn't turn it off. Try again."));
    }
    await queryClient.invalidateQueries({ queryKey: ["get", "/v1/me"] });
    toast.success("Two-step verification is off");
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Turn Off Two-Step Verification</DialogTitle>
            <DialogDescription>
              Enter the 6-digit code from your verification app.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="tf-off-code">6-Digit Code</FieldLabel>
            <Input
              id="tf-off-code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              autoFocus
            />
            <FieldDescription>Codes change every 30 seconds.</FieldDescription>
          </Field>
          {error && <FieldError>{error}</FieldError>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={disable.isPending}>
              {disable.isPending && <Spinner />} Disable
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
