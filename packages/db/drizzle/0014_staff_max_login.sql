CREATE TABLE "admin_max_logins" (
	"code_hash" varchar(64) PRIMARY KEY NOT NULL,
	"poll_hash" varchar(64) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"admin_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "admin_max_logins_poll_hash_unique" UNIQUE("poll_hash"),
	CONSTRAINT "admin_max_logins_status_check" CHECK ("admin_max_logins"."status" in ('pending', 'approved', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "admin_max_logins" ADD CONSTRAINT "admin_max_logins_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE cascade ON UPDATE no action;