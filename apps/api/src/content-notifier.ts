export type ContentRefreshResult = { ok: true; version: string; };

// Вызывать после успешной фиксации изменений контента в БД, а не внутри транзакции:
// бот в ответ на сигнал перечитывает данные через API и должен видеть уже сохраненную версию.
export const notifyBotContentChanged = async (botControlUrl: string, token: string): Promise<ContentRefreshResult> => {
	const response = await fetch(`${botControlUrl.replace(/\/+$/, '')}/internal/content/refresh`, {
		method: 'POST',
		headers: { authorization: `Bearer ${token}` },
		signal: AbortSignal.timeout(10_000),
	});

	if (!response.ok) {
		throw new Error(`Bot content refresh responded ${response.status}`);
	}

	const result = await response.json() as Partial<ContentRefreshResult> | null;

	if (!result || result.ok !== true || typeof result.version !== 'string' || !result.version) {
		throw new Error('Bot content refresh returned an invalid confirmation');
	}

	return { ok: true, version: result.version };
};
