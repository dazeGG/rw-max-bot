// Контракты HTTP API: общие для API, бота и админки

import type { ContentNode, Settings } from './content/types';

// Контент для бота. version меняется при любой правке, бот передает ее в If-None-Match
export type ContentSnapshot = {
	version: string;
	nodes: ContentNode[];
	settings: Settings;
};

export type BotLeaseRequest = {
	instanceId: string;
};

// Бот продлевает аренду втрое чаще, чем она истекает: одна потерянная попытка не отдает ее другому экземпляру
export const BOT_LEASE_TTL_SECONDS = 30;
export const BOT_LEASE_RENEW_SECONDS = 10;

export type AdminRole = 'admin' | 'editor';

export type AdminUser = {
	id: number;
	login: string;
	role: AdminRole;
};

export type LoginRequest = {
	login: string;
	password: string;
};

export type ApiError = {
	error: string;
};
