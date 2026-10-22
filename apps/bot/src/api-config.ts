import '@rw/runtime/env';

// Отдельно от config.ts: симулятору чата нужен API, но не токен бота
export const apiConfig = {
	url: process.env.API_URL ?? 'http://127.0.0.1:3001',
	token: process.env.INTERNAL_API_TOKEN ?? '',
} as const;
