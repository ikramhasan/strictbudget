import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@strictbudget/ui/components/card";
import { Checkbox } from "@strictbudget/ui/components/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@strictbudget/ui/components/field";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { $api } from "@/lib/api";
import { useInstance } from "@/lib/instance";

export const notificationsQueryOptions = () => $api.queryOptions("get", "/v1/me/notifications");

type Changes = {
  monthlySummary?: boolean;
  monthlySummaryAi?: boolean;
  budgets?: { budgetId: string; monthlySummary: boolean }[];
};

/**
 * Account and security emails aren't optional. The summary email's "Email settings" link lands
 * here (`/account?tab=notifications#settings-notifications`).
 */
export function NotificationsCard() {
  const queryClient = useQueryClient();
  const { email } = useInstance();
  const notifications = useQuery(notificationsQueryOptions());
  const update = $api.useMutation("patch", "/v1/me/notifications");
  async function save(body: Changes) {
    try {
      const saved = await update.mutateAsync({ body });
      queryClient.setQueryData(notificationsQueryOptions().queryKey, saved);
      toast.success("Notifications have been updated.");
    } catch {
      toast.error("Couldn't update the notifications. Try again.");
    }
  }

  const data = notifications.data;
  const disabled = !email || !data || update.isPending;
  const summaryOn = email && (data?.monthlySummary ?? true);
  const anyAi = data?.budgets.some((b) => b.aiEnabled) ?? false;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>
          {email
            ? "Choose the emails strictbudget sends you. Account and security emails always go out."
            : "This server doesn't send email, so there are no notifications to choose."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Field orientation="horizontal">
          <Checkbox
            id="notify-monthly-summary"
            checked={summaryOn}
            disabled={disabled}
            onCheckedChange={(checked) => save({ monthlySummary: checked === true })}
          />
          <FieldContent>
            <FieldLabel htmlFor="notify-monthly-summary" className="font-normal">
              Monthly summary
            </FieldLabel>
            <FieldDescription>
              On the 1st, an overview of last month for each budget: what came in, what went out,
              targets, and what's scheduled next.
            </FieldDescription>
          </FieldContent>
        </Field>
        {summaryOn && data && data.budgets.length > 0 && (
          <div className="grid gap-3 border-l pl-4 ml-2">
            {data.budgets.map((b) => (
              <Field key={b.budgetId} orientation="horizontal">
                <Checkbox
                  id={`notify-budget-${b.budgetId}`}
                  checked={b.monthlySummary}
                  disabled={disabled}
                  onCheckedChange={(checked) =>
                    save({ budgets: [{ budgetId: b.budgetId, monthlySummary: checked === true }] })
                  }
                />
                <FieldLabel htmlFor={`notify-budget-${b.budgetId}`} className="font-normal">
                  {b.name}
                </FieldLabel>
              </Field>
            ))}
            <Field orientation="horizontal">
              <Checkbox
                id="notify-summary-ai"
                checked={data.monthlySummaryAi}
                disabled={disabled}
                onCheckedChange={(checked) => save({ monthlySummaryAi: checked === true })}
              />
              <FieldContent>
                <FieldLabel htmlFor="notify-summary-ai" className="font-normal">
                  Include an AI overview
                </FieldLabel>
                <FieldDescription>
                  {anyAi
                    ? "A few lines on how the month went, on budgets with AI turned on."
                    : "Only on budgets with AI turned on; none of yours have it on."}
                </FieldDescription>
              </FieldContent>
            </Field>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
