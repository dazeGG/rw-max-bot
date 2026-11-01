import { useMutation } from '@tanstack/react-query';
import { Alert, Button, Card, Form, Input } from 'antd';

import type { LoginRequest } from '@rw/core';

import { api } from './api';
import { errorText, signedIn } from './session';

export const LoginPage = () => {
	const login = useMutation({ mutationFn: api.login, onSuccess: signedIn });

	return (
		<div className="center">
			<Card className="auth-card" title="ЖДЯ-бот">
				<Form<LoginRequest> layout="vertical" requiredMark={false} onFinish={values => login.mutate(values)}>
					<Form.Item name="login" label="Логин" rules={[{ required: true, message: 'Введите логин' }]}>
						<Input autoComplete="username" autoFocus />
					</Form.Item>
					<Form.Item name="password" label="Пароль" rules={[{ required: true, message: 'Введите пароль' }]}>
						<Input.Password autoComplete="current-password" />
					</Form.Item>
					{login.isError && <Alert className="form-alert" type="error" title={errorText(login.error)} />}
					<Button type="primary" htmlType="submit" block loading={login.isPending}>Войти</Button>
				</Form>
			</Card>
		</div>
	);
};
