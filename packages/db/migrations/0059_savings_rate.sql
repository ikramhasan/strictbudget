ALTER TABLE "budget" ADD COLUMN "savings_rate_goal" integer;--> statement-breakpoint
ALTER TABLE "category" ADD COLUMN "counts_as_saving" boolean DEFAULT false NOT NULL;