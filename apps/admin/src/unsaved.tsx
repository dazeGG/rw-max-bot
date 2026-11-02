import { Modal } from 'antd';
import { useCallback, useEffect, useRef } from 'react';
import { useBlocker } from 'react-router';

// Не дает уйти с несохраненными правками. leave() — для ухода со страницы после действия, которое правки отменило.
// modal нужно показать в разметке формы
export const useUnsavedGuard = (dirty: boolean, warning: string) => {
	const leaving = useRef(false);
	const dirtyRef = useRef(dirty);

	useEffect(() => {
		dirtyRef.current = dirty;
	}, [dirty]);

	const blocker = useBlocker(({ currentLocation, nextLocation }) =>
		dirtyRef.current && !leaving.current && currentLocation.pathname !== nextLocation.pathname);

	useEffect(() => {
		if (!dirty) {
			return;
		}

		const warn = (event: BeforeUnloadEvent) => event.preventDefault();

		window.addEventListener('beforeunload', warn);
		return () => window.removeEventListener('beforeunload', warn);
	}, [dirty]);

	const leave = useCallback(() => {
		leaving.current = true;
	}, []);

	const modal = (
		<Modal
			open={blocker.state === 'blocked'}
			title="Правки не сохранены"
			okText="Уйти без сохранения"
			okButtonProps={{ danger: true }}
			cancelText="Остаться"
			onOk={() => blocker.proceed?.()}
			onCancel={() => blocker.reset?.()}
		>
			{warning}
		</Modal>
	);

	return { leave, modal };
};
