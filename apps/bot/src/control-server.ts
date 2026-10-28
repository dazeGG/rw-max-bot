import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

// Отдельный внутренний порт: не зависит от webhook/polling MAX и не публикуется наружу.
export const createControlServer = (token: string, reload: () => Promise<string | null>) => {
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
		if (request.url !== '/internal/content/refresh') {
			send(404, { error: 'Not found' });
			return;
		}
		if (request.method !== 'POST') {
			response.setHeader('allow', 'POST');
			send(405, { error: 'Method not allowed' });
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
