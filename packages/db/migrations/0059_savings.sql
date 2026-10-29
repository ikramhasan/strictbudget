ALTER TABLE "budget" ADD COLUMN "savings_suggestion_dismissed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "category" ADD COLUMN "savings" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "category_target" ADD COLUMN "goal" text;--> statement-breakpoint
ALTER TABLE "category_target" ADD COLUMN "goal_amount" bigint;