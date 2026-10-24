CREATE TABLE "budget_former_member" (
	"budget_id" text NOT NULL,
	"user_id" text NOT NULL,
	"avatar_color" integer NOT NULL,
	"removed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_former_member_budget_id_user_id_pk" PRIMARY KEY("budget_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "budget_former_member" ADD CONSTRAINT "budget_former_member_budget_id_budget_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budget"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_former_member" ADD CONSTRAINT "budget_former_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;