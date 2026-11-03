CREATE TABLE "support_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"admin_id" integer NOT NULL,
	"title" varchar(100) NOT NULL,
	"command" varchar(50) NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "open_reason" varchar(20);--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "bot_misses" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "support_templates" ADD CONSTRAINT "support_templates_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "support_templates_command_idx" ON "support_templates" USING btree ("admin_id","command");