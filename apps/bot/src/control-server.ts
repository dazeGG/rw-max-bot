import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';

import type { SearchCheckResult } from '@rw/core';

const CHECK_TEXT_LIMIT = 1000;
const BODY_LIMIT = 16 * 1024;

// Сообщение слишком большого размера не читаем до конца: это внутренний порт, и такого запроса быть не должно
const readCheckText = async (request: IncomingMessage): Promise<string | null> => {
	let body = '';

	for await (const chunk of request) {
		body += String(chunk);

		if (body.length > BODY_LIMIT) {
			return null;
		}
	}

	try {
		const { text } = JSON.parse(body) as { text?: unknown; };
		return typeof text === 'string' && text.trim() && text.length <= CHECK_TEXT_LIMIT ? text : null;
	} catch {
		return null;
	}
};

// Отдельный внутренний порт: не зависит от webhook/polling MAX и не публикуется наружу.
export const createControlServer = (token: string, reload: () => Promise<string | null>, checkSearch: (text: string) => Promise<SearchCheckResult>) => {
	if (!token) {
		throw new Error('Control server token is required');
	}
	const digest = (value: string) => createHash('sha256').update(value).digest();
	const expected = digest(`Bearer ${token}`);

	const server = createServer((request, response) => {
		const send = (status: number, body: object) => {
			response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
			response.end(JSON.stringify(body));
		};
		if (!timingSafeEqual(digest(request.headers.authorization ?? ''), expected)) {
			send(401, { error: 'Unauthorized' });
			return;
		}
		if (request.url !== '/internal/content/refresh' && request.url !== '/internal/search/check') {
			send(404, { error: 'Not found' });
			return;
		}
		if (request.method !== 'POST') {
			response.setHeader('allow', 'POST');
			send(405, { error: 'Method not allowed' });
			return;
		}
		if (request.url === '/internal/search/check') {
			void readCheckText(request).then(async text => {
				if (!text) {
					send(400, { error: 'Text is required' });
					return;
				}
				send(200, await checkSearch(text));
			}).catch(() => send(503, { error: 'Search check failed' }));
			return;
		}
		void reload().then(version => {
			if (!version) {
				throw new Error('Content is not loaded');
			}
			send(200, { ok: true, version });
		}).catch(() => send(503, { error: 'Content refresh failed; cached content retained' }));
	});
	server.requestTimeout = 10_000;
	server.headersTimeout = 10_000;
	return server;
};
