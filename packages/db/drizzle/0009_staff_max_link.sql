CREATE TABLE "admin_max_links" (
	"token_hash" varchar(64) PRIMARY KEY NOT NULL,
	"admin_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "admin_max_links_admin_id_unique" UNIQUE("admin_id")
);
--> statement-breakpoint
ALTER TABLE "admins" ADD COLUMN "max_user_id" bigint;--> statement-breakpoint
ALTER TABLE "admin_max_links" ADD CONSTRAINT "admin_max_links_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admins" ADD CONSTRAINT "admins_max_user_id_unique" UNIQUE("max_user_id");