import { Button } from "@strictbudget/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@strictbudget/ui/components/card";
import { Checkbox } from "@strictbudget/ui/components/checkbox";
import { Field, FieldDescription, FieldError, FieldLabel } from "@strictbudget/ui/components/field";
import { Input } from "@strictbudget/ui/components/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@strictbudget/ui/components/item";
import { Spinner } from "@strictbudget/ui/components/spinner";
import { TabsContent } from "@strictbudget/ui/components/tabs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Monitor, Smartphone, Tablet } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { NameCard, OptionsCard } from "@/components/account-options";
import { ApiKeysCard } from "@/components/api-keys-card";
import { ConnectedAgentsCard } from "@/components/connected-agents-card";
import { DeleteAccountCard } from "@/components/delete-account";
import { NewPasswordFields, readNewPassword } from "@/components/new-password-fields";
import { NotificationsCard } from "@/components/notifications-card";
import { PictureField } from "@/components/picture-field";
import { SettingsLayout, SettingsSection } from "@/components/settings-layout";
import { TwoFactorCard } from "@/components/two-factor-card";
import { $api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-errors";
import { apiErrorMessage, budgetsQueryOptions, pickBudgetRedirect } from "@/lib/budgets";
import { useInstance } from "@/lib/instance";
import {
  deleteProfilePicture,
  PROFILE_PICTURE_PX,
  pictureSrc,
  uploadProfilePicture,
} from "@/lib/pictures";
import { refreshSession, sessionQueryOptions } from "@/lib/session";
import { ACCOUNT_TAB_IDS, ACCOUNT_TABS } from "@/lib/settings-index";

export const Route = createFileRoute("/_authed/account")({
  validateSearch: z.object({ tab: z.enum(ACCOUNT_TAB_IDS).optional().catch(undefined) }),
  component: AccountPage,
});

function AccountPage() {
  const { session } = Route.useRouteContext();
  const { tab = "profile" } = Route.useSearch();
  const navigate = Route.useNavigate();
  // The search reaches the settings of the budget "/" would open.
  const budgets = useQuery(budgetsQueryOptions()).data;
  const budgetId = budgets && pickBudgetRedirect(budgets);
  const budget = budgets?.budgets.find((b) => b.id === budgetId) ?? null;
  return (
    <SettingsLayout
      title="Account settings"
      tabs={ACCOUNT_TABS}
      tab={tab}
      onTabChange={(next) => navigate({ search: { tab: next }, replace: true })}
      budget={budget}
    >
      <TabsContent value="profile" className="grid gap-6">
        <SettingsSection id="profile-picture">
          <ProfilePictureCard />
        </SettingsSection>
        <SettingsSection id="first-name">
          <NameCard name={session.user.name} />
        </SettingsSection>
        <SettingsSection id="email">
          <EmailCard email={session.user.email} />
        </SettingsSection>
        <SettingsSection id="delete-account">
          <DeleteAccountCard />
        </SettingsSection>
      </TabsContent>
      <TabsContent value="security" className="grid gap-6">
        <SettingsSection id="password">
          <PasswordCard />
        </SettingsSection>
        <SettingsSection id="two-step">
          <TwoFactorCard />
        </SettingsSection>
        <SettingsSection id="devices">
          <DevicesCard />
        </SettingsSection>
      </TabsContent>
      <TabsContent value="preferences" className="grid gap-6">
        <SettingsSection id="options">
          <OptionsCard />
        </SettingsSection>
      </TabsContent>
      <TabsContent value="notifications" className="grid gap-6">
        <SettingsSection id="notifications">
          <NotificationsCard />
        </SettingsSection>
      </TabsContent>
      <TabsContent value="developer" className="grid gap-6">
        <SettingsSection id="api-keys">
          <ApiKeysCard />
        </SettingsSection>
        <SettingsSection id="connected-agents">
          <ConnectedAgentsCard />
        </SettingsSection>
      </TabsContent>
    </SettingsLayout>
  );
}

/** Cropped to a square, shown as a circle. */
function ProfilePictureCard() {
  const queryClient = useQueryClient();
  const user = useQuery(sessionQueryOptions).data?.user;
  const initial = user?.name.trim().charAt(0).toUpperCase() ?? "";
  async function done(message: string) {
    await refreshSession(queryClient);
    // Members' avatars elsewhere (Activity, moves) show it too.
    await queryClient.invalidateQueries();
    toast.success(message);
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile picture</CardTitle>
        <CardDescription>
          Optional. Shown as a circle wherever you are: the menu, Activity, and to the people you
          share a budget with.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <PictureField
          shape="circle"
          size={PROFILE_PICTURE_PX}
          src={pictureSrc(user?.image)}
          fallback={initial}
          label="Profile picture"
          cropTitle="Crop your profile picture"
          onPick={async (blob) => {
            await uploadProfilePicture(blob);
            await done("Profile picture saved.");
          }}
          onRemove={async () => {
            await deleteProfilePicture();
            await done("Profile picture removed.");
          }}
        />
      </CardContent>
    </Card>
  );
}

function EmailCard({ email }: { email: string }) {
  const queryClient = useQueryClient();
  const { email: sendsEmail } = useInstance();
  const change = $api.useMutation("post", "/v1/me/email");
  const [error, setError] = useState<string | null>(null);
  const [pendingTo, setPendingTo] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const newEmail = String(form.get("newEmail") ?? "").trim();
    setError(null);
    try {
      const result = await change.mutateAsync({
        body: { newEmail, password: String(form.get("password") ?? "") },
      });
      formElement.reset();
      if (result.status === "changed") {
        // A server that sends no email changes it at once.
        await refreshSession(queryClient);
        toast.success(`You now sign in with ${result.email}.`);
      } else setPendingTo(newEmail);
    } catch (e) {
      setError(apiErrorMessage(e, "Couldn't start the change. Try again."));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Email</CardTitle>
        <CardDescription>
          You sign in with <span className="font-medium text-foreground break-all">{email}</span>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {pendingTo ? (
          <div className="grid gap-3 text-sm" role="status">
            <p>
              We've emailed <span className="font-medium break-all">{email}</span> a link to approve
              the change. Once it's approved, we'll send a confirmation link to{" "}
              <span className="font-medium break-all">{pendingTo}</span>. Open that one in a browser
              where you're signed in, and your email changes.
            </p>
            <p className="text-muted-foreground">
              Both links expire in 1 hour. If the new address already has an account, no link is
              sent to it.
            </p>
            <div>
              <Button variant="outline" onClick={() => setPendingTo(null)}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="grid gap-4">
            <Field>
              <FieldLabel htmlFor="newEmail">New email</FieldLabel>
              <Input id="newEmail" name="newEmail" type="email" autoComplete="email" required />
            </Field>
            <Field>
              <FieldLabel htmlFor="emailPassword">Current password</FieldLabel>
              <Input
                id="emailPassword"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
              {sendsEmail && (
                <FieldDescription>
                  We'll ask your current address to approve the change first.
                </FieldDescription>
              )}
            </Field>
            {error && <FieldError>{error}</FieldError>}
            <div>
              <Button type="submit" disabled={change.isPending}>
                {change.isPending && <Spinner />}
                Change email
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function PasswordCard() {
  const queryClient = useQueryClient();
  const [signOutOthers, setSignOutOthers] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const read = readNewPassword(form);
    if ("error" in read) return setError(read.error);
    setPending(true);
    setError(null);
    const { error } = await authClient.changePassword({
      currentPassword: String(form.get("currentPassword") ?? ""),
      newPassword: read.password,
      revokeOtherSessions: signOutOthers,
    });
    setPending(false);
    if (error) {
      setError(authErrorMessage(error, "Couldn't change the password. Try again."));
      return;
    }
    formElement.reset();
    // Signing out the others replaces this device's session too.
    await refreshSession(queryClient);
    await queryClient.invalidateQueries({ queryKey: ["get", "/v1/me/sessions"] });
    toast.success(
      signOutOthers ? "Password changed. Other devices signed out." : "Password changed",
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>We'll email you when your password changes.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <Field>
            <FieldLabel htmlFor="currentPassword">Current password</FieldLabel>
            <Input
              id="currentPassword"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>
          <NewPasswordFields />
          <Field orientation="horizontal">
            <Checkbox
              id="signOutOthers"
              checked={signOutOthers}
              onCheckedChange={(checked) => setSignOutOthers(checked === true)}
            />
            <FieldLabel htmlFor="signOutOthers" className="font-normal">
              Sign out of all other devices
            </FieldLabel>
          </Field>
          {error && <FieldError>{error}</FieldError>}
          <div>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              Change password
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

const DEVICES_SHOWN = 5;

function DevicesCard() {
  const queryClient = useQueryClient();
  const sessions = $api.useQuery("get", "/v1/me/sessions");
  const revokeOne = $api.useMutation("delete", "/v1/me/sessions/{sessionId}");
  const revokeOthers = $api.useMutation("delete", "/v1/me/sessions");
  const list = sessions.data?.sessions ?? [];
  const others = list.filter((s) => !s.current);
  // This device and the latest few; the rest behind "Show all", so a long history stays short.
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? list : list.slice(0, DEVICES_SHOWN);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["get", "/v1/me/sessions"] });
  }

  async function signOutOne(sessionId: string) {
    try {
      await revokeOne.mutateAsync({ params: { path: { sessionId } } });
      toast.success("Device signed out");
    } catch (e) {
      toast.error(apiErrorMessage(e, "Couldn't sign out that device."));
    }
    await refresh();
  }

  async function signOutOthers() {
    try {
      await revokeOthers.mutateAsync({});
      toast.success("Other devices signed out");
    } catch (e) {
      toast.error(apiErrorMessage(e, "Couldn't sign out the other devices."));
    }
    await refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Devices</CardTitle>
        <CardDescription>
          Where your account is signed in. Sign out anything you don't recognise, then change your
          password.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {sessions.isPending ? (
          <Spinner />
        ) : sessions.isError ? (
          <FieldError>Couldn't load your devices.</FieldError>
        ) : (
          // One bordered list with dividers, like the register and Activity, not a stack of cards.
          <ItemGroup className="gap-0 rounded-lg border">
            {shown.map((s) => {
              const Icon =
                s.deviceType === "mobile"
                  ? Smartphone
                  : s.deviceType === "tablet"
                    ? Tablet
                    : Monitor;
              const name = [s.browser, s.os].filter(Boolean).join(" on ") || "Unknown device";
              return (
                <Item
                  key={s.id}
                  // ItemGroup is a list, so each session is an item of it.
                  role="listitem"
                  size="sm"
                  // Dividers between rows: Item's own (transparent) border would hide divide-y's.
                  className="rounded-none border-0 border-border border-t first:border-t-0"
                >
                  <ItemMedia variant="icon">
                    <Icon />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>
                      {name}
                      {s.current && (
                        <span className="font-normal text-muted-foreground text-xs">
                          This device
                        </span>
                      )}
                    </ItemTitle>
                    <ItemDescription>
                      Signed in {dateTime.format(new Date(s.createdAt))}
                      {s.ipAddress ? ` · ${s.ipAddress}` : ""}
                    </ItemDescription>
                  </ItemContent>
                  {!s.current && (
                    <ItemActions>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={revokeOne.isPending}
                        onClick={() => signOutOne(s.id)}
                      >
                        Sign out
                      </Button>
                    </ItemActions>
                  )}
                </Item>
              );
            })}
          </ItemGroup>
        )}
        {(others.length > 0 || list.length > DEVICES_SHOWN) && (
          <div className="flex flex-wrap items-center gap-2">
            {list.length > DEVICES_SHOWN && (
              <Button variant="ghost" size="sm" onClick={() => setShowAll(!showAll)}>
                {showAll ? "Show fewer" : `Show all ${list.length}`}
              </Button>
            )}
            {others.length > 0 && (
              <Button variant="outline" onClick={signOutOthers} disabled={revokeOthers.isPending}>
                {revokeOthers.isPending && <Spinner />}
                Sign out all other devices
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
