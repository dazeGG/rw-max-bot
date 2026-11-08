CREATE TABLE "support_digests" (
	"day" date PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_notifications" (
	"ticket_id" integer NOT NULL,
	"admin_id" integer NOT NULL,
	"mid" text NOT NULL,
	"text" text NOT NULL,
	CONSTRAINT "support_notifications_ticket_id_admin_id_pk" PRIMARY KEY("ticket_id","admin_id")
);
--> statement-breakpoint
ALTER TABLE "admins" ADD COLUMN "max_notify" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "assignee_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_notifications" ADD CONSTRAINT "support_notifications_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_notifications" ADD CONSTRAINT "support_notifications_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
UPDATE "admins" SET "max_notify" = true WHERE "role" = 'support';
