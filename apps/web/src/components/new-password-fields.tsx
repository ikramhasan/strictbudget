import { Field, FieldLabel } from "@strictbudget/ui/components/field";
import { Input } from "@strictbudget/ui/components/input";

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

/** New password plus confirmation; read them with `readNewPassword`. */
export function NewPasswordFields({ label = "New password" }: { label?: string }) {
  return (
    <>
      <Field>
        <FieldLabel htmlFor="newPassword">{label}</FieldLabel>
        <Input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          maxLength={MAX_PASSWORD_LENGTH}
          required
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="confirmPassword">Confirm new password</FieldLabel>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
        />
      </Field>
    </>
  );
}

export function readNewPassword(form: FormData): { password: string } | { error: string } {
  const password = String(form.get("newPassword") ?? "");
  if (password !== String(form.get("confirmPassword") ?? "")) {
    return { error: "The two passwords don't match." };
  }
  return { password };
}
