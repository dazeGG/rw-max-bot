import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Form, Input, QRCode } from 'antd';
import { useEffect, useState } from 'react';

import type { LoginRequest } from '@rw/core';

import { api } from './api';
import { errorText, signedIn } from './session';

const LOGIN_POLL_MS = 2_000;

const MaxLoginPanel = () => {
	const issue = useMutation({ mutationFn: api.createMaxLogin });
	const { mutate } = issue;
	const token = issue.data?.token;

	useEffect(() => mutate(), [mutate]);

	const poll = useQuery({
		queryKey: ['max-login', token],
		queryFn: () => api.pollMaxLogin(token!),
		enabled: Boolean(token),
		gcTime: 0,
		// Кнопка «Открыть в MAX» уводит на другую вкладку: опрос не должен вставать, пока эта скрыта
		refetchIntervalInBackground: true,
		refetchInterval: query => query.state.data && query.state.data.status !== 'pending' ? false : LOGIN_POLL_MS,
	});
	const result = poll.data;

	useEffect(() => {
		if (result?.status === 'done') {
			signedIn(result.user);
		}
	}, [result]);

	if (issue.isError) {
		return (
			<div className="max-link">
				<Alert type="error" title={errorText(issue.error)} />
				<Button onClick={() => mutate()}>Повторить</Button>
			</div>
		);
	}

	if (!issue.data) {
		return <div className="max-link muted">Загрузка…</div>;
	}

	if (result?.status === 'expired' || result?.status === 'rejected') {
		return (
			<div className="max-link">
				<div className="muted">{result.status === 'expired' ? 'Код устарел' : 'Вход отменён'}</div>
				<Button type="primary" loading={issue.isPending} onClick={() => mutate()}>Показать новый код</Button>
			</div>
		);
	}

	return (
		<div className="max-link">
			<QRCode value={issue.data.url} size={180} bordered={false} />
			<div className="muted">Наведите камеру телефона на код и подтвердите вход в боте. Код действует 5 минут.</div>
			<Button block href={issue.data.url} target="_blank" rel="noreferrer">Открыть в MAX на этом ПК</Button>
		</div>
	);
};

const PasswordForm = () => {
	const login = useMutation({ mutationFn: api.login, onSuccess: signedIn });

	return (
		<Form<LoginRequest> layout="vertical" size="large" requiredMark={false} onFinish={values => login.mutate(values)}>
			<Form.Item name="login" label="Логин" rules={[{ required: true, message: 'Введите логин' }]}>
				<Input prefix={<UserOutlined className="muted" />} autoComplete="username" autoFocus />
			</Form.Item>
			<Form.Item name="password" label="Пароль" rules={[{ required: true, message: 'Введите пароль' }]}>
				<Input.Password prefix={<LockOutlined className="muted" />} placeholder="Пароль" autoComplete="current-password" />
			</Form.Item>
			{login.isError && <Alert className="form-alert" type="error" title={errorText(login.error)} />}
			<Button type="primary" htmlType="submit" block loading={login.isPending}>Войти</Button>
		</Form>
	);
};

export const LoginPage = () => {
	const [byPassword, setByPassword] = useState(false);

	return (
		<div className="center">
			<Card className="auth-card">
				<div className="auth-head">
					<img src="/logo.png" alt="Логотип АО «АК «ЖДЯ»" />
					<h1>ЖДЯ-бот</h1>
					<div className="muted">Админка виртуального помощника в MAX</div>
				</div>
				{byPassword ? <PasswordForm /> : <MaxLoginPanel />}
				<Button type="link" block onClick={() => setByPassword(!byPassword)}>{byPassword ? 'Войти через MAX' : 'Войти по паролю'}</Button>
				<div className="auth-foot muted small">
					{byPassword ? 'Нет доступа или забыли пароль — попросите администратора прислать новую ссылку' : 'Профиль MAX ещё не привязан — войдите по паролю'}
				</div>
			</Card>
		</div>
	);
};
