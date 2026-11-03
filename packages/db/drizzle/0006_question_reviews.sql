CREATE TABLE "question_reviews" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"status" varchar(20) NOT NULL,
	"admin_id" integer NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "question_reviews" ADD CONSTRAINT "question_reviews_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;