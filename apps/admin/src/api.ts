// Только типы из @rw/core: код движка и начальный контент в сборку админки не попадают
import type { AdminUser, ApiError, ContentNode, LoginRequest, Settings } from '@rw/core';

export class UnauthorizedError extends Error {}

const request = async <T>(path: string, init: { method?: string; body?: unknown; } = {}): Promise<T> => {
	const response = await fetch(`/api${path}`, {
		method: init.method ?? 'GET',
		headers: init.body === undefined ? {} : { 'content-type': 'application/json' },
		body: init.body === undefined ? undefined : JSON.stringify(init.body),
	});

	if (!response.ok) {
		const body = await response.json().catch(() => null) as ApiError | null;
		const message = body?.error ?? `Ошибка ${response.status}`;
		throw response.status === 401 ? new UnauthorizedError(message) : new Error(message);
	}

	return response.status === 204 ? undefined as T : await response.json() as T;
};

export type ContentResponse = {
	nodes: ContentNode[];
	settings: Settings;
};

export const api = {
	me: () => request<AdminUser>('/auth/me'),
	login: (body: LoginRequest) => request<AdminUser>('/auth/login', { method: 'POST', body }),
	logout: () => request<void>('/auth/logout', { method: 'POST' }),
	content: () => request<ContentResponse>('/content'),
};
