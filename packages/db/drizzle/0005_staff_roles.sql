CREATE TABLE "admin_invites" (
	"token_hash" varchar(64) PRIMARY KEY NOT NULL,
	"admin_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "admin_invites_admin_id_unique" UNIQUE("admin_id")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_id" integer NOT NULL,
	"action" varchar(50) NOT NULL,
	"target_id" integer,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admins" DROP CONSTRAINT "admins_role_check";--> statement-breakpoint
ALTER TABLE "admins" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "admins" ALTER COLUMN "role" SET DEFAULT 'support';--> statement-breakpoint
ALTER TABLE "admins" ADD COLUMN "full_name" text;--> statement-breakpoint
UPDATE "admins" SET "full_name" = "login";--> statement-breakpoint
ALTER TABLE "admins" ALTER COLUMN "full_name" SET NOT NULL;--> statement-breakpoint
-- Прежний admin управлял всем и становится суперадмином, прежний editor правил контент и становится админом
UPDATE "admins" SET "role" = CASE "role" WHEN 'admin' THEN 'superadmin' WHEN 'editor' THEN 'admin' ELSE "role" END;--> statement-breakpoint
ALTER TABLE "admin_invites" ADD CONSTRAINT "admin_invites_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_admins_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "admins" ADD CONSTRAINT "admins_role_check" CHECK ("admins"."role" in ('superadmin', 'admin', 'support'));