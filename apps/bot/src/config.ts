import '@rw/runtime/env';

import fs from 'node:fs';

import { repoPath } from '@rw/runtime';

// Выложенный коммит: deploy.sh пишет его в REVISION, локально файла нет
const readRevision = (): string | null => {
	try {
		return fs.readFileSync(repoPath('REVISION'), 'utf8').trim() || null;
	} catch {
		return null;
	}
};

const required = (name: string): string => {
	const value = process.env[name];

	if (!value) {
		throw new Error(`${name} is required (see deploy/.env.example)`);
	}

	return value;
};

const refreshSeconds = Number(process.env.CONTENT_REFRESH_SECONDS || 300);
const controlPort = Number(process.env.BOT_CONTROL_PORT ?? 3002);

if (!Number.isInteger(controlPort) || controlPort < 1 || controlPort > 65535) {
	throw new Error('BOT_CONTROL_PORT must be a port number');
}

if (!Number.isInteger(refreshSeconds) || refreshSeconds < 1) {
	throw new Error('CONTENT_REFRESH_SECONDS must be a positive integer');
}

export const config = {
	controlHost: process.env.BOT_CONTROL_HOST ?? '127.0.0.1',
	controlPort,
	botToken: required('BOT_TOKEN'),
	webhook: {
		domain: required('WEBHOOK_DOMAIN'),
		path: process.env.WEBHOOK_PATH ?? '/webhook',
		secret: required('WEBHOOK_SECRET'),
		port: Number(process.env.PORT ?? 3000),
	},
	contentRefreshSeconds: refreshSeconds,
	// Пока сотрудникам не открыта админка, отвечать пассажирам некому
	supportChatEnabled: process.env.SUPPORT_CHAT_ENABLED === 'true',
	revision: readRevision(),
} as const;
