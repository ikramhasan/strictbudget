"use client";

import { Questionnaire as QuestionnairePrimitive } from "@shadcn/react/questionnaire";
import { type Button, buttonVariants } from "@strictbudget/ui/components/button";
import { cn } from "@strictbudget/ui/lib/utils";
import { CheckIcon } from "lucide-react";
import * as React from "react";

function Questionnaire({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Root>) {
  return (
    <QuestionnairePrimitive.Root
      data-slot="questionnaire"
      className={cn("flex w-full min-w-0 flex-col gap-4", className)}
      {...props}
    />
  );
}

function QuestionnaireProgress({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Progress>) {
  return (
    <QuestionnairePrimitive.Progress
      data-slot="questionnaire-progress"
      className={cn(
        "min-h-[1lh] w-fit min-w-[14ch] text-xs font-medium text-muted-foreground tabular-nums",
        className,
      )}
      {...props}
    />
  );
}

function QuestionnaireItem({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Item>) {
  return (
    <QuestionnairePrimitive.Item
      data-slot="questionnaire-item"
      className={cn("flex min-w-0 flex-col gap-4 border-0 p-0 outline-none", className)}
      {...props}
    />
  );
}

function QuestionnaireTitle({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Title>) {
  return (
    <QuestionnairePrimitive.Title
      data-slot="questionnaire-title"
      className={cn(
        // A legend sits outside the fieldset's flex gap, so it carries its
        // own spacing: 4px to a description, 16px to the choices.
        "mb-1 text-base leading-5 font-medium text-pretty [&:not(:has(~[data-slot=questionnaire-description]))]:mb-4",
        className,
      )}
      {...props}
    />
  );
}

function QuestionnaireDescription({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Description>) {
  return (
    <QuestionnairePrimitive.Description
      data-slot="questionnaire-description"
      className={cn("text-sm text-pretty text-muted-foreground", className)}
      {...props}
    />
  );
}

function QuestionnaireChoices({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Choices>) {
  return (
    <QuestionnairePrimitive.Choices
      data-slot="questionnaire-choices"
      className={cn("group/questionnaire-choices grid min-w-0 gap-2", className)}
      {...props}
    />
  );
}

function QuestionnaireChoice({
  children,
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Choice>) {
  return (
    <QuestionnairePrimitive.Choice
      data-slot="questionnaire-choice"
      className={cn(
        // The Field choice card: 44px for one line (1px border + 11px + 20px
        // line + 11px + 1px), 12px in, the input focus ring. Checked takes a
        // primary/30 border on a primary/5 fill.
        "group/questionnaire-choice relative flex min-h-11 cursor-pointer items-start gap-2.5 rounded-lg border border-input bg-background px-3 py-[11px] text-start text-sm leading-5 shadow-xs transition-[background-color,border-color,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] outline-none select-none not-data-[checked]:hover:bg-accent/50 has-[>input:focus-visible]:border-ring has-[>input:focus-visible]:ring-3 has-[>input:focus-visible]:ring-ring/30 data-[checked]:border-primary/30 data-[checked]:bg-[color-mix(in_oklch,var(--primary)_5%,var(--background))] data-[invalid]:border-destructive dark:shadow-[0_1px_2px_rgb(0_0_0/0.4)] dark:has-[>input:focus-visible]:ring-ring/40 dark:data-[checked]:border-primary/20 dark:data-[checked]:bg-[color-mix(in_oklch,var(--primary)_10%,var(--background))]",
        "data-[disabled]:pointer-events-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <QuestionnairePrimitive.ChoiceInput
        data-slot="questionnaire-choice-input"
        className="absolute inset-0 z-10 size-full cursor-pointer opacity-0"
      />
      {/* The Checkbox and Radio skins: a raised secondary key, with the
          default Button's skin fading in on ::before when checked. Centered
          on the first 20px line. */}
      <span
        aria-hidden="true"
        data-slot="questionnaire-choice-indicator"
        className="pointer-events-none relative flex size-4 shrink-0 translate-y-0.5 items-center justify-center rounded-[4px] border border-[color-mix(in_oklch,var(--input),var(--foreground)_48%)] bg-linear-to-b from-background to-secondary text-primary-foreground shadow-[0_1px_2px_rgb(0_0_0/0.06),inset_0_-1px_0_rgb(0_0_0/0.03)] transition-[border-color,box-shadow,scale] duration-150 ease-out group-active/questionnaire-choice:scale-95 group-data-[checked]/questionnaire-choice:border-[color-mix(in_oklch,var(--primary),black_15%)] group-data-[checked]/questionnaire-choice:shadow-[0_1px_2px_rgb(30_60_160/0.28)] group-data-[type=radio]/questionnaire-choice:rounded-full before:absolute before:-inset-px before:rounded-[inherit] before:bg-linear-to-b before:from-[color-mix(in_oklch,var(--primary),white_15%)] before:to-primary before:opacity-0 before:shadow-[inset_0_1px_0_rgb(255_255_255/0.22)] before:transition-opacity before:duration-150 before:ease-out group-data-[checked]/questionnaire-choice:before:opacity-100 motion-reduce:group-active/questionnaire-choice:scale-100 dark:border-[color-mix(in_oklch,var(--input),var(--foreground)_35%)] dark:from-[color-mix(in_oklch,var(--secondary),var(--foreground)_4%)] dark:shadow-[0_1px_2px_rgb(0_0_0/0.4),inset_0_1px_0_rgb(255_255_255/0.06)] dark:group-data-[checked]/questionnaire-choice:shadow-[0_1px_2px_rgb(0_0_0/0.45)]"
      >
        {/* The dot grows from half size; the tick draws itself. */}
        <span
          data-slot="questionnaire-choice-indicator-dot"
          className="relative size-1.5 scale-50 rounded-full bg-primary-foreground opacity-0 shadow-[0_1px_1px_rgb(0_0_0/0.15)] transition-[scale,opacity] duration-100 ease-[cubic-bezier(0.23,1,0.32,1)] group-data-[checked]/questionnaire-choice:scale-100 group-data-[checked]/questionnaire-choice:opacity-100 group-data-[checked]/questionnaire-choice:duration-200 group-data-[type=checkbox]/questionnaire-choice:hidden motion-reduce:scale-100 motion-reduce:transition-opacity"
        />
        <CheckIcon
          data-slot="questionnaire-choice-indicator-check"
          className="relative size-3 stroke-3 group-data-[type=radio]/questionnaire-choice:hidden [&_path]:transition-[stroke-dashoffset] [&_path]:duration-100 [&_path]:ease-[cubic-bezier(0.23,1,0.32,1)] [&_path]:[stroke-dasharray:24] [&_path]:[stroke-dashoffset:-24] group-data-[checked]/questionnaire-choice:[&_path]:delay-50 group-data-[checked]/questionnaire-choice:[&_path]:duration-200 group-data-[checked]/questionnaire-choice:[&_path]:[stroke-dashoffset:0] motion-reduce:[&_path]:transition-none"
        />
      </span>
      <QuestionnairePrimitive.ChoiceLabel
        data-slot="questionnaire-choice-label"
        className="flex min-w-0 flex-1 flex-col gap-0.5"
      >
        {children}
      </QuestionnairePrimitive.ChoiceLabel>
      {/* The recessed Kbd keycap, 20px on the first line. */}
      <QuestionnairePrimitive.ChoiceShortcut
        data-slot="questionnaire-choice-shortcut"
        className="pointer-events-none ms-auto hidden h-5 min-w-5 shrink-0 items-center justify-center rounded-sm bg-muted bg-linear-to-b from-[color-mix(in_oklch,var(--muted),var(--foreground)_7%)] to-muted px-1 font-sans text-xs leading-4 font-medium text-[color-mix(in_oklch,var(--muted-foreground),var(--foreground)_20%)] uppercase shadow-[inset_0_1px_1.5px_rgb(0_0_0/0.12),inset_0_0_0_1px_rgb(0_0_0/0.05),0_1px_0_rgb(255_255_255/0.9)] group-data-[shortcut]/questionnaire-choice:inline-flex dark:from-[color-mix(in_oklch,var(--muted),black_35%)] dark:text-muted-foreground dark:shadow-[inset_0_1px_1.5px_rgb(0_0_0/0.6),inset_0_0_0_1px_rgb(0_0_0/0.25),0_1px_0_rgb(255_255_255/0.07)]"
      />
    </QuestionnairePrimitive.Choice>
  );
}

function QuestionnaireChoiceDescription({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="questionnaire-choice-description"
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  );
}

function QuestionnaireInput({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Input>) {
  return (
    <div
      data-slot="questionnaire-input-wrapper"
      className="group/questionnaire-input relative w-full min-w-0"
    >
      <QuestionnairePrimitive.Input
        data-slot="questionnaire-input"
        className={cn(
          // The Input: 32px (44px on touch screens), 10px in, the soft focus
          // ring.
          "h-8 min-h-11 w-full min-w-0 rounded-lg border border-input bg-background px-2.5 py-1 text-base shadow-xs transition-[color,border-color,box-shadow] outline-none placeholder:text-muted-foreground hover:border-[color-mix(in_oklch,var(--input),var(--foreground)_10%)] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive/25 sm:min-h-0 md:text-sm dark:shadow-[0_1px_2px_rgb(0_0_0/0.4)] dark:focus-visible:ring-ring/40 dark:aria-invalid:focus-visible:ring-destructive/40",
          className,
        )}
        {...props}
      />
    </div>
  );
}

function QuestionnaireError({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Error>) {
  return (
    <QuestionnairePrimitive.Error
      data-slot="questionnaire-error"
      className={cn(
        // The Field error, 6px under the choices.
        "-mt-2.5 text-[13px] leading-4 text-destructive",
        className,
      )}
      {...props}
    />
  );
}

function QuestionnaireActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="questionnaire-actions"
      className={cn(
        "grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 sm:min-h-8",
        className,
      )}
      {...props}
    />
  );
}

function QuestionnairePrevious({
  children,
  className,
  size = "default",
  variant = "outline",
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Previous> &
  Pick<React.ComponentProps<typeof Button>, "size" | "variant">) {
  return (
    <QuestionnairePrimitive.Previous
      data-slot="questionnaire-previous"
      data-size={size}
      data-variant={variant}
      className={cn(
        buttonVariants({ size, variant }),
        "col-start-1 row-start-1 min-h-11 justify-self-start sm:min-h-0",
        className,
      )}
      {...props}
    >
      {children ?? "Previous"}
    </QuestionnairePrimitive.Previous>
  );
}

function QuestionnaireSkip({
  children,
  className,
  size = "default",
  variant = "outline",
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Skip> &
  Pick<React.ComponentProps<typeof Button>, "size" | "variant">) {
  return (
    <QuestionnairePrimitive.Skip
      data-slot="questionnaire-skip"
      data-size={size}
      data-variant={variant}
      className={cn(
        buttonVariants({ size, variant }),
        "col-start-2 row-start-1 min-h-11 justify-self-end sm:min-h-0",
        className,
      )}
      {...props}
    >
      {children ?? "Skip"}
    </QuestionnairePrimitive.Skip>
  );
}

function QuestionnaireNext({
  children,
  className,
  size = "default",
  variant = "default",
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Next> &
  Pick<React.ComponentProps<typeof Button>, "size" | "variant">) {
  return (
    <QuestionnairePrimitive.Next
      data-slot="questionnaire-next"
      data-size={size}
      data-variant={variant}
      className={cn(
        buttonVariants({ size, variant }),
        "col-start-3 row-start-1 min-h-11 justify-self-end sm:min-h-0",
        className,
      )}
      {...props}
    >
      {children ?? "Next"}
    </QuestionnairePrimitive.Next>
  );
}

function QuestionnaireSubmit({
  children,
  className,
  size = "default",
  variant = "default",
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Submit> &
  Pick<React.ComponentProps<typeof Button>, "size" | "variant">) {
  return (
    <QuestionnairePrimitive.Submit
      data-slot="questionnaire-submit"
      data-size={size}
      data-variant={variant}
      className={cn(
        buttonVariants({ size, variant }),
        "col-start-3 row-start-1 min-h-11 justify-self-end sm:min-h-0",
        className,
      )}
      {...props}
    >
      {children ?? "Submit"}
    </QuestionnairePrimitive.Submit>
  );
}

export {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireError,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSkip,
  QuestionnaireSubmit,
  QuestionnaireTitle,
};
