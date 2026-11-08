import '@rw/runtime/env';

const required = (name: string): string => {
	const value = process.env[name];

	if (!value) {
		throw new Error(`${name} is required (see deploy/.env.example)`);
	}

	return value;
};

const port = Number(process.env.API_PORT ?? 3001);

if (!Number.isInteger(port) || port < 1) {
	throw new Error('API_PORT must be a port number');
}

export const config = {
	// Снаружи API доступен только через nginx: по умолчанию слушаем localhost
	host: process.env.API_HOST ?? '127.0.0.1',
	port,
	// Общий секрет бота и API для запросов /internal/*
	internalToken: required('INTERNAL_API_TOKEN'),
	// Внутренний HTTP-сервер бота для уведомлений об изменении контента
	botControlUrl: process.env.BOT_CONTROL_URL ?? 'http://127.0.0.1:3002',
	// На сервере админка работает по HTTPS: cookie сессии не уходит по открытому HTTP
	secureCookies: process.env.ADMIN_COOKIE_SECURE === 'true',
} as const;
