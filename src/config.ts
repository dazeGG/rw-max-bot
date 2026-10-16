import 'dotenv/config';

const required = (name: string): string => {
	const value = process.env[name];

	if (!value) {
		throw new Error(`${name} is required (see .env.example)`);
	}

	return value;
};

const mode = process.env.BOT_MODE ?? 'polling';

if (mode !== 'polling' && mode !== 'webhook') {
	throw new Error('BOT_MODE must be "polling" or "webhook"');
}

const refreshSeconds = Number(process.env.CONTENT_REFRESH_SECONDS || 30);

if (!Number.isInteger(refreshSeconds) || refreshSeconds < 1) {
	throw new Error('CONTENT_REFRESH_SECONDS must be a positive integer');
}

export const config = {
	botToken: required('BOT_TOKEN'),
	mode,
	webhook: mode === 'webhook'
		? {
			domain: required('WEBHOOK_DOMAIN'),
			path: process.env.WEBHOOK_PATH ?? '/webhook',
			secret: required('WEBHOOK_SECRET'),
			port: Number(process.env.PORT ?? 3000),
		}
		: null,
	contentRefreshSeconds: refreshSeconds,
} as const;
