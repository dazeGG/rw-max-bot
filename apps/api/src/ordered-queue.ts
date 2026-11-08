// Работы с одним ключом выполняются по очереди. Сбой одной работы не отменяет следующие
export const orderedQueue = () => {
	const tails = new Map<number, Promise<unknown>>();

	return (key: number, work: () => Promise<void>) => {
		const next = (tails.get(key) ?? Promise.resolve()).then(work, work);
		const forget = () => {
			if (tails.get(key) === next) {
				tails.delete(key);
			}
		};

		tails.set(key, next);
		next.then(forget, forget);

		return next;
	};
};
