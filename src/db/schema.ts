import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, integer, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';
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
