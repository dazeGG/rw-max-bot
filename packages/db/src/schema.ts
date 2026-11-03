import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import type { SupportAttachment } from '@rw/core';

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

// Сотрудники. Пароль — scrypt-хеш (apps/api/src/auth/password.ts); null — сотрудник еще не задал его по ссылке
export const admins = pgTable('admins', {
	id: serial('id').primaryKey(),
	login: varchar('login', { length: 100 }).notNull().unique(),
	fullName: text('full_name').notNull(),
	passwordHash: text('password_hash'),
	role: varchar('role', { length: 20, enum: ['superadmin', 'admin', 'support'] }).notNull().default('support'),
	isActive: boolean('is_active').notNull().default(true),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
}, table => [
	check('admins_role_check', sql`${table.role} in ('superadmin', 'admin', 'support')`),
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

// Одноразовые ссылки для задания пароля: при добавлении сотрудника и при сбросе. У сотрудника действует только последняя
export const adminInvites = pgTable('admin_invites', {
	tokenHash: varchar('token_hash', { length: 64 }).primaryKey(),
	adminId: integer('admin_id').notNull().unique().references(() => admins.id, { onDelete: 'cascade' }),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

// Журнал действий сотрудников. action — например staff.create; подробности в details, их состав можно расширять
export const auditLog = pgTable('audit_log', {
	id: serial('id').primaryKey(),
	actorId: integer('actor_id').notNull().references(() => admins.id),
	action: varchar('action', { length: 50 }).notNull(),
	targetId: integer('target_id'),
	details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
	index('audit_log_created_idx').on(table.createdAt),
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

// Обращения в чат поддержки: queue — в очереди, active — в работе, closed — закрыто.
// Открытое обращение у пассажира может быть только одно
export const supportTickets = pgTable('support_tickets', {
	id: serial('id').primaryKey(),
	userId: bigint('user_id', { mode: 'number' }).notNull(),
	status: varchar('status', { length: 10 }).notNull(),
	assigneeId: integer('assignee_id').references(() => admins.id),
	// passenger или staff: от этого зависят «ждет ответа» и автозакрытие
	lastSender: varchar('last_sender', { length: 10 }),
	lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
	takenAt: timestamp('taken_at', { withTimezone: true }),
	closedAt: timestamp('closed_at', { withTimezone: true }),
	closeReason: varchar('close_reason', { length: 10 }),
	// Почему пассажир пришел к оператору: unrecognized, noOption или asked. У старых обращений пусто
	openReason: varchar('open_reason', { length: 20 }),
	// Сколько раз бот не понял пассажира незадолго до обращения
	botMisses: integer('bot_misses').notNull().default(0),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
	uniqueIndex('support_tickets_open_idx').on(table.userId).where(sql`status <> 'closed'`),
	index('support_tickets_status_idx').on(table.status, table.lastMessageAt),
	index('support_tickets_user_idx').on(table.userId),
]);

export const supportMessages = pgTable('support_messages', {
	id: serial('id').primaryKey(),
	ticketId: integer('ticket_id').notNull().references(() => supportTickets.id),
	// passenger, staff или system
	sender: varchar('sender', { length: 10 }).notNull(),
	adminId: integer('admin_id').references(() => admins.id),
	text: text('text').notNull().default(''),
	attachments: jsonb('attachments').$type<SupportAttachment[]>().notNull().default([]),
	delivery: varchar('delivery', { length: 10 }),
	// Номер сообщения в MAX: одно и то же обновление может прийти повторно
	mid: text('mid'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
	index('support_messages_ticket_idx').on(table.ticketId, table.id),
	uniqueIndex('support_messages_mid_idx').on(table.mid).where(sql`mid is not null`),
]);

// Шаблоны ответов. У каждого сотрудника свои: другие их не видят
export const supportTemplates = pgTable('support_templates', {
	id: serial('id').primaryKey(),
	adminId: integer('admin_id').notNull().references(() => admins.id),
	title: varchar('title', { length: 100 }).notNull(),
	// Набирается в ответе после косой черты
	command: varchar('command', { length: 50 }).notNull(),
	text: text('text').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
	uniqueIndex('support_templates_command_idx').on(table.adminId, table.command),
]);

// Обработанные вопросы пассажиров. Сами вопросы лежат в dialog_events, key — хеш нормализованной фразы:
// длинное сообщение не поместилось бы в индекс
export const questionReviews = pgTable('question_reviews', {
	key: varchar('key', { length: 64 }).primaryKey(),
	status: varchar('status', { length: 20 }).notNull(),
	adminId: integer('admin_id').notNull().references(() => admins.id),
	reviewedAt: timestamp('reviewed_at', { withTimezone: true }).notNull().defaultNow(),
});

// Снимок каждой версии контента, которую API отдавал боту: на нее ссылается dialog_events.content_version
export const contentVersions = pgTable('content_versions', {
	version: varchar('version', { length: 64 }).primaryKey(),
	nodes: jsonb('nodes').notNull(),
	settings: jsonb('settings').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
