import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App as AntApp, Button, Form, Input, Modal, Select, Table, Tabs, Tag } from 'antd';
import type { TableColumnsType } from 'antd';
import { useState } from 'react';

import type { AdminRole, AdminUser, AuditEntry, CreateStaffRequest, StaffInvite, StaffMember } from '@rw/core';

import { api } from './api';
import { errorText, ROLE_LABELS } from './session';

const formatDate = (value: string) => new Date(value).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });

const StatusTag = ({ member }: { member: StaffMember; }) => {
	if (!member.isActive) {
		return <Tag>Отключен</Tag>;
	}

	if (member.hasPassword) {
		return <Tag color="success">Активен</Tag>;
	}

	return member.inviteExpiresAt && new Date(member.inviteExpiresAt) > new Date()
		? <Tag color="processing">Ждем пароль до {formatDate(member.inviteExpiresAt)}</Tag>
		: <Tag color="warning">Ссылка истекла</Tag>;
};

const InviteModal = ({ invite, onClose }: { invite: StaffInvite; onClose: () => void; }) => {
	const { message } = AntApp.useApp();
	const url = `${location.origin}/invite/${invite.token}`;

	const copy = async () => {
		await navigator.clipboard.writeText(url);
		void message.success('Ссылка скопирована');
	};

	return (
		<Modal open title="Ссылка для сотрудника" onCancel={onClose} footer={<Button type="primary" onClick={onClose}>Готово</Button>}>
			<p>Перешлите ссылку сотруднику, чтобы задать пароль. Она одноразовая, действует до {formatDate(invite.expiresAt)} и больше показана не будет.</p>
			<Input.Search readOnly value={url} enterButton="Скопировать" onSearch={() => void copy()} />
		</Modal>
	);
};

type EditorState = { kind: 'create'; } | { kind: 'edit'; member: StaffMember; };

const StaffEditor = ({ state, user, onClose, onInvite }: { state: EditorState; user: AdminUser; onClose: () => void; onInvite: (invite: StaffInvite) => void; }) => {
	const queryClient = useQueryClient();
	const member = state.kind === 'edit' ? state.member : undefined;
	const superadmin = user.role === 'superadmin';

	const save = useMutation({
		mutationFn: async (values: CreateStaffRequest) => {
			if (!member) {
				onInvite(await api.createStaff(values));
				return;
			}

			await api.updateStaff(member.id, { fullName: values.fullName, ...values.role !== member.role && { role: values.role } });
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ['staff'] });
			onClose();
		},
	});

	const roles: AdminRole[] = superadmin ? ['superadmin', 'admin', 'support'] : ['support'];

	return (
		<Modal
			open
			title={member ? 'Изменить сотрудника' : 'Добавить сотрудника'}
			okText={member ? 'Сохранить' : 'Добавить'}
			cancelText="Отмена"
			confirmLoading={save.isPending}
			onCancel={onClose}
			okButtonProps={{ htmlType: 'submit', form: 'staff-form' }}
		>
			<Form<CreateStaffRequest>
				id="staff-form"
				layout="vertical"
				requiredMark={false}
				initialValues={member ?? { role: 'support' }}
				onFinish={values => save.mutate(values)}
			>
				<Form.Item name="fullName" label="ФИО" rules={[{ required: true, whitespace: true, message: 'Введите ФИО' }]}>
					<Input autoFocus />
				</Form.Item>
				<Form.Item name="login" label="Логин" rules={[{ required: true, pattern: /^\S+$/, message: 'Логин без пробелов' }]}>
					<Input disabled={Boolean(member)} autoComplete="off" />
				</Form.Item>
				<Form.Item name="role" label="Роль">
					<Select
						disabled={!superadmin || member?.id === user.id}
						options={roles.map(role => ({ value: role, label: ROLE_LABELS[role] }))}
					/>
				</Form.Item>
				{save.isError && <Alert className="form-alert" type="error" title={errorText(save.error)} />}
			</Form>
		</Modal>
	);
};

const StaffTable = ({ user }: { user: AdminUser; }) => {
	const { message, modal } = AntApp.useApp();
	const queryClient = useQueryClient();
	const staff = useQuery({ queryKey: ['staff'], queryFn: api.staff });
	const [editor, setEditor] = useState<EditorState | null>(null);
	const [invite, setInvite] = useState<StaffInvite | null>(null);

	const refresh = () => queryClient.invalidateQueries({ queryKey: ['staff'] });
	const showError = (error: unknown) => void message.error(errorText(error));

	const reissue = useMutation({
		mutationFn: api.reissueInvite,
		onSuccess: created => {
			setInvite(created);
			void refresh();
		},
		onError: showError,
	});
	const disable = useMutation({ mutationFn: api.disableStaff, onSuccess: refresh, onError: showError });
	const enable = useMutation({ mutationFn: api.enableStaff, onSuccess: refresh, onError: showError });

	const columns: TableColumnsType<StaffMember> = [
		{ title: 'ФИО', dataIndex: 'fullName' },
		{ title: 'Логин', dataIndex: 'login' },
		{ title: 'Роль', dataIndex: 'role', render: (role: AdminRole) => ROLE_LABELS[role] },
		{ title: 'Статус', key: 'status', render: (_, member) => <StatusTag member={member} /> },
		{ title: 'Последний вход', dataIndex: 'lastLoginAt', render: (value: string | null) => value ? formatDate(value) : '—' },
		{
			title: 'Действия',
			key: 'actions',
			render: (_, member) => (
				<div className="row-actions">
					<Button size="small" onClick={() => setEditor({ kind: 'edit', member })}>Изменить</Button>
					{member.id === user.id && <span className="muted">это вы</span>}
					{member.id !== user.id && member.isActive && (
						<>
							<Button
								size="small"
								onClick={() => modal.confirm({
									title: `Сбросить пароль: ${member.fullName}?`,
									content: 'Старый пароль перестанет работать, все входы сотрудника завершатся. Вы получите новую ссылку.',
									okText: 'Сбросить',
									cancelText: 'Отмена',
									onOk: () => reissue.mutate(member.id),
								})}
							>
								{member.hasPassword ? 'Сбросить пароль' : 'Новая ссылка'}
							</Button>
							<Button
								size="small"
								danger
								onClick={() => modal.confirm({
									title: `Отключить: ${member.fullName}?`,
									content: 'Доступ закроется сразу на всех устройствах. Сотрудника можно будет включить обратно.',
									okText: 'Отключить',
									okButtonProps: { danger: true },
									cancelText: 'Отмена',
									onOk: () => disable.mutate(member.id),
								})}
							>
								Отключить
							</Button>
						</>
					)}
					{member.id !== user.id && !member.isActive && (
						<Button size="small" onClick={() => enable.mutate(member.id)}>Включить</Button>
					)}
				</div>
			),
		},
	];

	return (
		<>
			<div className="page-actions">
				<Button type="primary" onClick={() => setEditor({ kind: 'create' })}>Добавить сотрудника</Button>
			</div>
			{staff.isError && <Alert className="form-alert" type="error" title={errorText(staff.error)} />}
			<Table<StaffMember>
				rowKey="id"
				size="middle"
				loading={staff.isPending}
				dataSource={staff.data}
				columns={columns}
				pagination={false}
				scroll={{ x: 'max-content' }}
			/>
			{editor && <StaffEditor state={editor} user={user} onClose={() => setEditor(null)} onInvite={setInvite} />}
			{invite && <InviteModal invite={invite} onClose={() => setInvite(null)} />}
		</>
	);
};

const ACTION_LABELS: Record<string, string> = {
	'staff.create': 'Добавление сотрудника',
	'staff.update': 'Изменение сотрудника',
	'staff.reset_password': 'Сброс пароля',
	'staff.disable': 'Отключение',
	'staff.enable': 'Включение',
	'content.create': 'Новый пункт',
	'content.update': 'Изменение раздела',
	'content.move': 'Перенос раздела',
	'content.delete': 'Удаление раздела',
};

const FIELD_LABELS: Record<string, string> = {
	title: 'название',
	text: 'текст',
	url: 'адрес',
	targetId: 'цель перехода',
	synonyms: 'фразы',
	imageText: 'текст с картинки',
	isActive: 'включение',
	isHidden: 'скрытие',
};

const roleLabel = (value: unknown) => ROLE_LABELS[value as AdminRole] ?? String(value);

const auditDetails = ({ details }: AuditEntry) => [
	details.role && `роль: ${roleLabel(details.role)}`,
	details.fromRole && `роль: ${roleLabel(details.fromRole)} → ${roleLabel(details.toRole)}`,
	details.fromName && `ФИО: ${String(details.fromName)} → ${String(details.toName)}`,
	Array.isArray(details.fields) && `поля: ${details.fields.map(field => FIELD_LABELS[String(field)] ?? String(field)).join(', ')}`,
	Number(details.removed) > 1 && `вместе с вложенными: ${Number(details.removed) - 1}`,
].filter(Boolean).join(', ');

const AuditTable = () => {
	const log = useQuery({ queryKey: ['audit-log'], queryFn: api.auditLog });

	const columns: TableColumnsType<AuditEntry> = [
		{ title: 'Когда', dataIndex: 'createdAt', render: (value: string) => formatDate(value) },
		{ title: 'Кто', dataIndex: 'actorName' },
		{ title: 'Действие', dataIndex: 'action', render: (action: string) => ACTION_LABELS[action] ?? action },
		{ title: 'Объект', key: 'target', render: (_, entry) => String(entry.details.login ?? entry.details.title ?? '—') },
		{ title: 'Подробности', key: 'details', render: (_, entry) => auditDetails(entry) || '—' },
	];

	return (
		<>
			{log.isError && <Alert className="form-alert" type="error" title={errorText(log.error)} />}
			<Table<AuditEntry>
				rowKey="id"
				size="middle"
				loading={log.isPending}
				dataSource={log.data}
				columns={columns}
				pagination={{ pageSize: 50, hideOnSinglePage: true }}
				scroll={{ x: 'max-content' }}
			/>
		</>
	);
};

export const StaffPage = ({ user }: { user: AdminUser; }) => (
	<main className="page">
		{user.role === 'superadmin'
			? (
				<Tabs
					destroyOnHidden
					items={[
						{ key: 'staff', label: 'Сотрудники', children: <StaffTable user={user} /> },
						{ key: 'log', label: 'Журнал действий', children: <AuditTable /> },
					]}
				/>
			)
			: <StaffTable user={user} />}
	</main>
);
