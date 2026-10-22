import type { BotLeaseRequest, ContentSnapshot, DialogUser, Session, UnrecognizedEvent } from '@rw/core';

// Зависший API не должен задерживать ответ пользователю дольше этого
const REQUEST_TIMEOUT_MS = 5_000;

export class ApiRequestError extends Error {
	constructor (readonly status: number, path: string) {
		super(`API ${path} responded ${status}`);
	}
}

// Клиент внутреннего API (/internal/*): бот работает с данными только через него
export class ApiClient {
	private readonly baseUrl: string;

	constructor (baseUrl: string, private readonly token: string) {
		this.baseUrl = baseUrl.replace(/\/+$/, '');
	}

	private async request (method: string, path: string, { body, headers = {} }: { body?: unknown; headers?: Record<string, string>; } = {}): Promise<Response> {
		const response = await fetch(`${this.baseUrl}/internal${path}`, {
			method,
			headers: {
				authorization: `Bearer ${this.token}`,
				...body === undefined ? {} : { 'content-type': 'application/json' },
				...headers,
			},
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});

		if (!response.ok && response.status !== 304 && response.status !== 409) {
			throw new ApiRequestError(response.status, path);
		}

		return response;
	}

	// null — контент не изменился с версии version
	async getContent (version?: string): Promise<ContentSnapshot | null> {
		const response = await this.request('GET', '/content', { headers: version ? { 'if-none-match': `"${version}"` } : {} });
		return response.status === 304 ? null : await response.json() as ContentSnapshot;
	}

	async getSession (userId: number): Promise<Session> {
		return await (await this.request('GET', `/sessions/${userId}`)).json() as Session;
	}

	async setSession (userId: number, session: Session): Promise<void> {
		await this.request('PUT', `/sessions/${userId}`, { body: session });
	}

	async touchSubscriber (user: DialogUser): Promise<void> {
		await this.request('POST', '/subscribers', { body: user });
	}

	async markSubscriberBlocked (userId: number): Promise<void> {
		await this.request('POST', `/subscribers/${userId}/blocked`);
	}

	async saveUnrecognized (event: UnrecognizedEvent): Promise<void> {
		await this.request('POST', '/unrecognized', { body: event });
	}

	// false — аренду держит другой экземпляр бота
	async acquireLease (instanceId: string): Promise<boolean> {
		const body: BotLeaseRequest = { instanceId };
		return (await this.request('POST', '/bot/lease', { body })).status !== 409;
	}

	async releaseLease (instanceId: string): Promise<void> {
		await this.request('DELETE', `/bot/lease/${encodeURIComponent(instanceId)}`);
	}
}
