CREATE TABLE "dialog_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"type" varchar(20) NOT NULL,
	"node_code" varchar(100),
	"text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dialog_events_type_check" CHECK (type in ('start', 'answer', 'option', 'clarify', 'unrecognized', 'back', 'menu', 'more', 'goodbye'))
);
--> statement-breakpoint
CREATE INDEX "dialog_events_created_idx" ON "dialog_events" USING btree ("created_at");