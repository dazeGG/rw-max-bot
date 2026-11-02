import { useCallback, useRef, useState } from 'react';

import { api } from './api';

type Status = 'idle' | 'applying' | 'applied' | 'deferred';

const LABELS: Record<Status, string> = {
	idle: '',
	applying: 'Бот применяет правки…',
	applied: 'Бот применил правки',
	deferred: 'Правка сохранена. Бот применит ее в течение 5 минут',
};

// Бот перестраивает индекс поиска несколько секунд, поэтому сохранение его не ждет.
// При правках подряд статус показывает только последний сигнал: бот в итоге применит самую свежую версию
export const useApply = () => {
	const [status, setStatus] = useState<Status>('idle');
	const last = useRef(0);

	const apply = useCallback(() => {
		const id = ++last.current;

		setStatus('applying');
		api.applyContent().then(
			() => {
				if (id === last.current) {
					setStatus('applied');
				}
			},
			() => {
				if (id === last.current) {
					setStatus('deferred');
				}
			},
		);
	}, []);

	return { status, apply };
};

export const ApplyStatus = ({ status }: { status: Status; }) => status === 'idle'
	? null
	: <div className={status === 'deferred' ? 'apply-status warn' : 'apply-status'} role="status">{LABELS[status]}</div>;
