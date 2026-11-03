import { useMutation } from '@tanstack/react-query';
import { Alert, App as AntApp, Button, Card, Descriptions, Form, Input } from 'antd';

import type { AdminUser } from '@rw/core';

import { api } from './api';
import { PageHeader } from './page';
import { PasswordFields } from './PasswordFields';
import { errorText, ROLE_LABELS, signedOut } from './session';

type PasswordForm = { currentPassword: string; password: string; };

export const AccountPage = ({ user }: { user: AdminUser; }) => {
	const { message, modal } = AntApp.useApp();
	const [form] = Form.useForm<PasswordForm>();

	const changePassword = useMutation({
		mutationFn: ({ currentPassword, password }: PasswordForm) => api.changePassword({ currentPassword, newPassword: password }),
		onSuccess: () => {
			form.resetFields();
			void message.success('Пароль изменен. Остальные входы завершены');
		},
	});

	const logoutAll = useMutation({ mutationFn: api.logoutAll, onSuccess: signedOut });

	return (
		<>
			<PageHeader title="Профиль" />
			<main className="page-body narrow">
				<Card title="Сотрудник">
					<Descriptions column={1} items={[
						{ key: 'name', label: 'ФИО', children: user.fullName },
						{ key: 'login', label: 'Логин', children: user.login },
						{ key: 'role', label: 'Роль', children: ROLE_LABELS[user.role] },
					]} />
				</Card>
				<Card title="Сменить пароль">
					<Form form={form} layout="vertical" requiredMark={false} onFinish={values => changePassword.mutate(values)}>
						<Form.Item name="currentPassword" label="Текущий пароль" rules={[{ required: true, message: 'Введите текущий пароль' }]}>
							<Input.Password autoComplete="current-password" />
						</Form.Item>
						<PasswordFields />
						{changePassword.isError && <Alert className="form-alert" type="error" title={errorText(changePassword.error)} />}
						<Button type="primary" htmlType="submit" loading={changePassword.isPending}>Сменить пароль</Button>
					</Form>
				</Card>
				<Card title="Входы">
					<Button
						danger
						loading={logoutAll.isPending}
						onClick={() => modal.confirm({
							title: 'Выйти на всех устройствах?',
							content: 'Войти заново придется и на этом устройстве.',
							okText: 'Выйти',
							cancelText: 'Отмена',
							onOk: () => logoutAll.mutate(),
						})}
					>
					Выйти на всех устройствах
					</Button>
				</Card>
			</main>
		</>
	);
};
