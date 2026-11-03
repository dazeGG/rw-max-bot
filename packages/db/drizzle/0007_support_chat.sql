CREATE TABLE "support_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer NOT NULL,
	"sender" varchar(10) NOT NULL,
	"admin_id" integer,
	"text" text DEFAULT '' NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"delivery" varchar(10),
	"mid" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"status" varchar(10) NOT NULL,
	"assignee_id" integer,
	"last_sender" varchar(10),
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"taken_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"close_reason" varchar(10),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assignee_id_admins_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_messages_ticket_idx" ON "support_messages" USING btree ("ticket_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "support_messages_mid_idx" ON "support_messages" USING btree ("mid") WHERE mid is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "support_tickets_open_idx" ON "support_tickets" USING btree ("user_id") WHERE status <> 'closed';--> statement-breakpoint
CREATE INDEX "support_tickets_status_idx" ON "support_tickets" USING btree ("status","last_message_at");--> statement-breakpoint
CREATE INDEX "support_tickets_user_idx" ON "support_tickets" USING btree ("user_id");--> statement-breakpoint
-- Вход в чат: пункт в разделе поддержки и такой же в главном меню. На пустой базе разделов еще нет, их создаст начальный контент.
-- На рабочей базе пункты выключены: пока сотрудникам не открыта админка, пассажиры писали бы в пустоту, а бот им не отвечал
INSERT INTO "content_nodes" ("parent_id", "code", "type", "title", "is_active", "sort", "updated_by")
SELECT "s"."id", 'operator', 'section', 'Написать оператору', false,
	COALESCE((SELECT max("sort") + 10 FROM "content_nodes" WHERE "parent_id" = "s"."id"), 10), 'migration'
FROM "content_nodes" "s" WHERE "s"."code" = 'support'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "content_nodes" ("parent_id", "code", "type", "title", "target_id", "is_active", "sort", "updated_by")
SELECT "r"."id", 'operator-menu', 'goto', 'Написать оператору', "o"."id", false,
	COALESCE((SELECT max("sort") + 10 FROM "content_nodes" WHERE "parent_id" = "r"."id"), 10), 'migration'
FROM "content_nodes" "r"
JOIN "content_nodes" "o" ON "o"."code" = 'operator'
WHERE "r"."code" = 'root'
ON CONFLICT ("code") DO NOTHING;
