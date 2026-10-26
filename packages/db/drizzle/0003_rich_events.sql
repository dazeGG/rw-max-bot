CREATE TABLE "content_versions" (
	"version" varchar(64) PRIMARY KEY NOT NULL,
	"nodes" jsonb NOT NULL,
	"settings" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dialog_events" DROP CONSTRAINT "dialog_events_type_check";--> statement-breakpoint
ALTER TABLE "dialog_events" ALTER COLUMN "type" SET DATA TYPE varchar(50);--> statement-breakpoint
ALTER TABLE "dialog_events" ADD COLUMN "node_id" integer;--> statement-breakpoint
ALTER TABLE "dialog_events" ADD COLUMN "content_version" varchar(64);--> statement-breakpoint
ALTER TABLE "dialog_events" ADD COLUMN "data" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "dialog_events" ADD COLUMN "raw" jsonb;--> statement-breakpoint
CREATE INDEX "dialog_events_user_idx" ON "dialog_events" USING btree ("user_id","created_at");--> statement-breakpoint
-- Записи, накопленные до расширения журнала: раздел по коду (контент с тех пор не менялся), формат data — версия 0
UPDATE "dialog_events" e SET "node_id" = n."id", "data" = '{"v": 0}'::jsonb FROM "content_nodes" n WHERE n."code" = e."node_code" AND e."node_id" IS NULL;--> statement-breakpoint
UPDATE "dialog_events" SET "data" = '{"v": 0}'::jsonb WHERE "data" = '{}'::jsonb;
