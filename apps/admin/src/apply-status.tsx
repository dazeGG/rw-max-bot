import { CheckCircleOutlined, ClockCircleOutlined, SyncOutlined } from '@ant-design/icons';
import { Tag } from 'antd';
import { useCallback, useRef, useState } from 'react';

import { api } from './api';
import { formatTime } from './labels';

type Status = 'idle' | 'applying' | 'applied' | 'deferred';

// Бот перестраивает индекс поиска несколько секунд, поэтому сохранение его не ждет.
// При правках подряд статус показывает только последний сигнал: бот в итоге применит все
export const useApply = () => {
	const [status, setStatus] = useState<Status>('idle');
	const [appliedAt, setAppliedAt] = useState('');
	const last = useRef(0);

	const apply = useCallback(() => {
		const id = ++last.current;

		setStatus('applying');
		api.applyContent().then(
			() => {
				if (id === last.current) {
					setStatus('applied');
					setAppliedAt(new Date().toISOString());
				}
			},
			() => {
				if (id === last.current) {
					setStatus('deferred');
				}
			},
		);
	}, []);

	return { status, appliedAt, apply };
};

export const ApplyStatus = ({ status, appliedAt }: { status: Status; appliedAt: string; }) => {
	switch (status) {
	case 'idle':
		return null;

	case 'applying':
		return <Tag role="status" color="processing" icon={<SyncOutlined spin />}>Бот применяет правки…</Tag>;

	case 'applied':
		return <Tag role="status" color="success" icon={<CheckCircleOutlined />}>Бот применил правки · {formatTime(appliedAt)}</Tag>;

	case 'deferred':
		return <Tag role="status" color="warning" icon={<ClockCircleOutlined />}>Правка сохранена. Бот применит ее в течение 5 минут</Tag>;
	}
};
