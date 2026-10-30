import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, integer, jsonb, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

// Разделы и меню бота (ТЗ п. 4.1 «Разделы и меню бота»)
export const contentNodes = pgTable('content_nodes', {
	id: serial('id').primaryKey(),
	parentId: integer('parent_id').references((): AnyPgColumn => contentNodes.id, { onDelete: 'cascade' }),
	code: varchar('code', { length: 100 }).notNull().unique(),
	type: varchar('type', { length: 20, enum: ['section', 'link', 'goto'] }).notNull().default('section'),
	title: text('title').notNull(),
	text: text('text'),
	url: text('url'),
	targetId: integer('target_id').references((): AnyPgColumn => contentNodes.id, { onDelete: 'set null' }),
	image: text('image'),
	imageText: text('image_text'),
	file: text('file'),
	fileName: text('file_name'),
	synonyms: text('synonyms').array().notNull().default(sql`'{}'::text[]`),
	sort: integer('sort').notNull().default(0),
	isActive: boolean('is_active').notNull().default(true),
	isHidden: boolean('is_hidden').notNull().default(false),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
	updatedBy: text('updated_by'),
}, table => [
	index('content_nodes_parent_idx').on(table.parentId),
	check('content_nodes_type_check', sql`${table.type} in ('section', 'link', 'goto')`),
]);

// Служебные тексты бота: приветствие, подсказка на непонятный ввод, «Уточните, пожалуйста…»
export const settings = pgTable('settings', {
	key: varchar('key', { length: 100 }).primaryKey(),
	value: text('value').notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Подписчики (ТЗ п. 4.1 «Подписчики»)
export const subscribers = pgTable('subscribers', {
	userId: bigint('user_id', { mode: 'number' }).primaryKey(),
	firstName: text('first_name'),
	lastName: text('last_name'),
	username: text('username'),
	firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
	lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
	mailingConsent: boolean('mailing_consent').notNull().default(true),
	isBlocked: boolean('is_blocked').notNull().default(false),
});

// Текущий раздел диалога пользователя: переживает перезапуск бота
export const sessions = pgTable('sessions', {
	userId: bigint('user_id', { mode: 'number' }).primaryKey(),
	nodeId: integer('node_id'),
	choices: integer('choices').array().notNull().default(sql`'{}'::integer[]`),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Пользователи админки. Пароль — scrypt-хеш (apps/api/src/auth/password.ts)
export const admins = pgTable('admins', {
	id: serial('id').primaryKey(),
	login: varchar('login', { length: 100 }).notNull().unique(),
	passwordHash: text('password_hash').notNull(),
	role: varchar('role', { length: 20, enum: ['admin', 'editor'] }).notNull().default('editor'),
	isActive: boolean('is_active').notNull().default(true),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
}, table => [
	check('admins_role_check', sql`${table.role} in ('admin', 'editor')`),
]);

// Сессии входа в админку: в cookie лежит случайный токен, в БД — только его SHA-256
export const adminSessions = pgTable('admin_sessions', {
	tokenHash: varchar('token_hash', { length: 64 }).primaryKey(),
	adminId: integer('admin_id').notNull().references(() => admins.id, { onDelete: 'cascade' }),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, table => [
	index('admin_sessions_admin_idx').on(table.adminId),
]);

// Фразы, которые бот не понял: по ним контент-менеджер добавляет синонимы
export const unrecognizedMessages = pgTable('unrecognized_messages', {
	id: serial('id').primaryKey(),
	userId: bigint('user_id', { mode: 'number' }).notNull(),
	text: text('text').notNull(),
	nodeId: integer('node_id'),
	resolvedNodeId: integer('resolved_node_id'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
	index('unrecognized_messages_created_idx').on(table.createdAt),
]);

// Журнал для статистики: сообщения пользователей и прочие обновления MAX (DialogEventRecord в @rw/core).
// type без ограничений — новые типы событий не требуют миграций. Раздел записан и id, и кодом, и версией контента:
// пока контент перезаливается из seed-data.ts, id меняются, а по content_versions видно меню, которое видел пользователь
export const dialogEvents = pgTable('dialog_events', {
	id: serial('id').primaryKey(),
	userId: bigint('user_id', { mode: 'number' }).notNull(),
	type: varchar('type', { length: 50 }).notNull(),
	nodeId: integer('node_id'),
	nodeCode: varchar('node_code', { length: 100 }),
	contentVersion: varchar('content_version', { length: 64 }),
	text: text('text'),
	data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
	raw: jsonb('raw'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
	index('dialog_events_created_idx').on(table.createdAt),
	index('dialog_events_user_idx').on(table.userId, table.createdAt),
]);

// Снимок каждой версии контента, которую API отдавал боту: на нее ссылается dialog_events.content_version
export const contentVersions = pgTable('content_versions', {
	version: varchar('version', { length: 64 }).primaryKey(),
	nodes: jsonb('nodes').notNull(),
	settings: jsonb('settings').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
