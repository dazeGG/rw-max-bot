import { useMutation } from '@tanstack/react-query';
import { Alert, App as AntApp, Button, Card, Descriptions, Form, Input, Modal, Switch } from 'antd';
import { useCallback, useState } from 'react';

import type { AdminUser } from '@rw/core';

import { api } from './api';
import { MaxLinkPanel } from './MaxLink';
import { PageHeader } from './page';
import { PasswordFields } from './PasswordFields';
import { errorText, refreshMe, ROLE_LABELS, signedOut } from './session';

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

	const setNotify = useMutation({ mutationFn: api.setMaxNotify, onSuccess: () => refreshMe() });

	const [linking, setLinking] = useState(false);

	const linked = useCallback(() => {
		setLinking(false);
		void refreshMe();
		void message.success('Профиль MAX привязан');
	}, [message]);

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
				<Card title="Профиль MAX">
					<p>{user.maxLinked ? 'Привязан' : 'Не привязан'}</p>
					<Button onClick={() => setLinking(true)}>{user.maxLinked ? 'Перепривязать' : 'Привязать'}</Button>
					<label className="max-notify">
						<Switch
							checked={user.maxNotify}
							disabled={!user.maxLinked}
							loading={setNotify.isPending}
							onChange={enabled => setNotify.mutate(enabled)}
						/>
						Уведомления о заявках в MAX
					</label>
					{setNotify.isError && <Alert className="form-alert" type="error" title={errorText(setNotify.error)} />}
					{linking && (
						<Modal open title="Привязка профиля MAX" footer={null} onCancel={() => setLinking(false)}>
							<MaxLinkPanel onDone={linked} />
						</Modal>
					)}
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
