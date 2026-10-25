import { Button } from "@strictbudget/ui/components/button";
import { Field, FieldError, FieldLabel } from "@strictbudget/ui/components/field";
import { Input } from "@strictbudget/ui/components/input";
import { Spinner } from "@strictbudget/ui/components/spinner";
import { UserRound } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { PROFILE_PICTURE_PX } from "@/lib/pictures";
import { PictureField } from "./picture-field";

export interface SignUpValues {
  name: string;
  email: string;
  password: string;
  /** Already cropped. */
  picture: Blob | null;
}

export function SignUpForm({
  onSubmit,
}: {
  onSubmit: (values: SignUpValues) => Promise<string | null>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [picture, setPicture] = useState<Blob | null>(null);
  const preview = useMemo(() => (picture ? URL.createObjectURL(picture) : undefined), [picture]);
  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const message = await onSubmit({
      name: String(form.get("name") ?? ""),
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      picture,
    });
    setPending(false);
    setError(message);
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <Field>
        <FieldLabel>
          Profile picture <span className="font-normal text-muted-foreground">(optional)</span>
        </FieldLabel>
        <PictureField
          shape="circle"
          size={PROFILE_PICTURE_PX}
          src={preview}
          fallback={<UserRound className="size-6" />}
          label="Profile picture"
          cropTitle="Crop your profile picture"
          onPick={setPicture}
          onRemove={() => setPicture(null)}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="name">Name</FieldLabel>
        <Input id="name" name="name" autoComplete="name" required />
      </Field>
      <Field>
        <FieldLabel htmlFor="email">Email</FieldLabel>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Field>
        <FieldLabel htmlFor="password">Password</FieldLabel>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </Field>
      {error && <FieldError>{error}</FieldError>}
      <Button type="submit" disabled={pending}>
        {pending && <Spinner />}
        {pending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
