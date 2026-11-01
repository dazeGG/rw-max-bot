// Контракты HTTP API: общие для API, бота и админки

import type { ContentNode, Settings } from './content/types';

// Контент для бота. version меняется при любой правке, бот передает ее в If-None-Match
export type ContentSnapshot = {
	version: string;
	nodes: ContentNode[];
	settings: Settings;
};

// Запись журнала для статистики (POST /internal/events). type — тип из DialogEventType или тип обновления MAX
// (bot_stopped, message_edited…). Неизменные поля — колонки, все подробности — в data и raw (jsonb): их состав
// можно расширять без миграций, data.v — версия формата
export type DialogEventRecord = {
	userId: number;
	type: string;
	nodeId: number | null;
	nodeCode: string | null;
	contentVersion: string | null;
	text: string | null;
	data: Record<string, unknown>;
	// Исходное обновление MAX целиком
	raw: unknown;
	// Когда бот получил обновление (ISO 8601)
	createdAt: string;
};

export type BotLeaseRequest = {
	instanceId: string;
};

// Бот продлевает аренду втрое чаще, чем она истекает: одна потерянная попытка не отдает ее другому экземпляру
export const BOT_LEASE_TTL_SECONDS = 30;
export const BOT_LEASE_RENEW_SECONDS = 10;

export type AdminRole = 'superadmin' | 'admin' | 'support';

export type AdminUser = {
	id: number;
	login: string;
	fullName: string;
	role: AdminRole;
};

export type LoginRequest = {
	login: string;
	password: string;
};

export type ChangePasswordRequest = {
	currentPassword: string;
	newPassword: string;
};

export type InviteInfo = {
	login: string;
	fullName: string;
};

export type AcceptInviteRequest = {
	password: string;
};

export type StaffMember = AdminUser & {
	isActive: boolean;
	hasPassword: boolean;
	lastLoginAt: string | null;
	inviteExpiresAt: string | null;
};

export type CreateStaffRequest = {
	login: string;
	fullName: string;
	role: AdminRole;
};

export type UpdateStaffRequest = {
	fullName?: string;
	role?: AdminRole;
};

// Токен показывается один раз: в БД лежит только его хеш
export type StaffInvite = {
	token: string;
	expiresAt: string;
};

export type AuditEntry = {
	id: number;
	actorName: string;
	action: string;
	details: Record<string, unknown>;
	createdAt: string;
};

export type ApiError = {
	error: string;
};
