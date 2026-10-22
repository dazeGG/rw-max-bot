import { randomUUID } from 'node:crypto';

import { BOT_LEASE_RENEW_SECONDS } from '@rw/core';
import { errorMessage } from '@rw/runtime';

import type { ApiClient } from './api-client';
import { logger } from './logger';

export type InstanceLease = {
	release: () => Promise<void>;
};

// Два запущенных бота забирают одни и те же сообщения из MAX и отвечают дважды.
// Работает только экземпляр, который держит аренду в API; null — ее держит другой.
// onLost вызывается, если аренду перехватил другой экземпляр (например, после перезапуска API).
export const acquireInstanceLease = async (api: ApiClient, onLost: () => void): Promise<InstanceLease | null> => {
	const instanceId = randomUUID();

	if (!await api.acquireLease(instanceId)) {
		return null;
	}

	// Если API недоступен, продолжаем работать: второй экземпляр без API тоже не получит аренду
	const timer = setInterval(() => {
		api.acquireLease(instanceId)
			.then(held => {
				if (!held) {
					clearInterval(timer);
					onLost();
				}
			})
			.catch((error: unknown) => logger.warn('Instance lease renewal failed', { error: errorMessage(error) }));
	}, BOT_LEASE_RENEW_SECONDS * 1000);

	timer.unref();

	return {
		release: async () => {
			clearInterval(timer);
			await api.releaseLease(instanceId).catch(() => undefined);
		},
	};
};
