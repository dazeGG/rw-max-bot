CREATE TABLE "content_nodes" (
	"id" serial PRIMARY KEY NOT NULL,
	"parent_id" integer,
	"code" varchar(100) NOT NULL,
	"type" varchar(20) DEFAULT 'section' NOT NULL,
	"title" text NOT NULL,
	"text" text,
	"url" text,
	"target_id" integer,
	"image" text,
	"file" text,
	"file_name" text,
	"synonyms" text[] DEFAULT '{}'::text[] NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "content_nodes_code_unique" UNIQUE("code"),
	CONSTRAINT "content_nodes_type_check" CHECK ("content_nodes"."type" in ('section', 'link', 'goto'))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"user_id" bigint PRIMARY KEY NOT NULL,
	"node_id" integer,
	"choices" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" varchar(100) PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscribers" (
	"user_id" bigint PRIMARY KEY NOT NULL,
	"first_name" text,
	"last_name" text,
	"username" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"mailing_consent" boolean DEFAULT true NOT NULL,
	"is_blocked" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unrecognized_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"text" text NOT NULL,
	"node_id" integer,
	"resolved_node_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_nodes" ADD CONSTRAINT "content_nodes_parent_id_content_nodes_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."content_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_nodes" ADD CONSTRAINT "content_nodes_target_id_content_nodes_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."content_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_nodes_parent_idx" ON "content_nodes" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "unrecognized_messages_created_idx" ON "unrecognized_messages" USING btree ("created_at");