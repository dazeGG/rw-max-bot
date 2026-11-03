import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import { Alert, Button, Card, Form, Input } from 'antd';

import type { LoginRequest } from '@rw/core';

import { api } from './api';
import { errorText, signedIn } from './session';

export const LoginPage = () => {
	const login = useMutation({ mutationFn: api.login, onSuccess: signedIn });

	return (
		<div className="center">
			<Card className="auth-card">
				<div className="auth-head">
					<img src="/logo.png" alt="Логотип АО «АК «ЖДЯ»" />
					<h1>ЖДЯ-бот</h1>
					<div className="muted">Админка виртуального помощника в MAX</div>
				</div>
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
				<div className="auth-foot muted small">Нет доступа или забыли пароль — попросите администратора прислать новую ссылку</div>
			</Card>
		</div>
	);
};
