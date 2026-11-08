import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, QRCode } from 'antd';
import { useEffect } from 'react';

import type { AdminUser } from '@rw/core';

import { api } from './api';
import { errorText, logOut, refreshMe } from './session';

const STATUS_POLL_MS = 2_000;

// Ссылка выдается при открытии: бот сообщит API, кто ее открыл, а экран узнает об этом опросом
export const MaxLinkPanel = ({ onDone }: { onDone: () => void; }) => {
	const issue = useMutation({ mutationFn: api.createMaxLink });
	const { mutate } = issue;
	const url = issue.data?.url;

	useEffect(() => mutate(), [mutate]);

	const status = useQuery({
		queryKey: ['max-link-status', url],
		queryFn: api.maxLinkStatus,
		enabled: Boolean(url),
		gcTime: 0,
		refetchInterval: query => query.state.data && query.state.data.status !== 'pending' ? false : STATUS_POLL_MS,
	});
	const state = status.data?.status;

	useEffect(() => {
		if (state === 'done') {
			onDone();
		}
	}, [state, onDone]);

	if (issue.isError) {
		return (
			<div className="max-link">
				<Alert type="error" title={errorText(issue.error)} />
				<Button onClick={() => mutate()}>Повторить</Button>
			</div>
		);
	}

	if (!url) {
		return <div className="max-link muted">Загрузка…</div>;
	}

	if (state === 'expired') {
		return (
			<div className="max-link">
				<div className="muted">Ссылка устарела</div>
				<Button type="primary" loading={issue.isPending} onClick={() => mutate()}>Получить новую</Button>
			</div>
		);
	}

	return (
		<div className="max-link">
			<QRCode value={url} size={180} bordered={false} />
			<div className="muted">Отсканируйте код телефоном или откройте ссылку в MAX. Ссылка действует 15 минут.</div>
			<Button type="primary" block href={url} target="_blank" rel="noreferrer">Открыть в MAX</Button>
		</div>
	);
};

export const MaxLinkPage = ({ user }: { user: AdminUser; }) => (
	<div className="center">
		<Card className="auth-card">
			<div className="auth-head">
				<img src="/logo.png" alt="Логотип АО «АК «ЖДЯ»" />
				<h1>Привяжите профиль MAX</h1>
				<div className="muted">{user.fullName}, без привязки админка недоступна</div>
			</div>
			<MaxLinkPanel onDone={() => void refreshMe()} />
			<Button type="link" block onClick={() => void logOut()}>Выйти</Button>
		</Card>
	</div>
);
