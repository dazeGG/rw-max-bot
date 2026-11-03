import { EllipsisOutlined, LockOutlined, StopOutlined, UserAddOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App as AntApp, Badge, Button, Card, Dropdown, Form, Input, Modal, Select, Table, Tag } from 'antd';
import type { MenuProps, TableColumnsType } from 'antd';
import { useState } from 'react';

import type { AdminRole, AdminUser, AuditEntry, CreateStaffRequest, StaffInvite, StaffMember } from '@rw/core';

import { api } from './api';
import { ACTION_LABELS, fieldLabels, formatDate, formatDay, formatWhen } from './labels';
import { PageHeader, PersonAvatar, staffInitials } from './page';
import { errorText, ROLE_LABELS } from './session';

const ROLE_COLORS: Record<AdminRole, string | undefined> = {
	superadmin: 'purple',
	admin: 'processing',
	support: undefined,
};

const inviteActive = (member: StaffMember) => member.inviteExpiresAt !== null && new Date(member.inviteExpiresAt) > new Date();

const StatusBadge = ({ member }: { member: StaffMember; }) => {
	if (!member.isActive) {
		return <Badge status="default" text={<span className="muted">Отключён</span>} />;
	}

	if (member.hasPassword) {
		return <Badge status="success" text="Активен" />;
	}

	return inviteActive(member)
		? <Badge status="processing" text={`Ждём пароль до ${formatWhen(member.inviteExpiresAt!)}`} />
		: <Badge status="warning" text="Ссылка истекла" />;
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

const StaffTable = ({ user, editor, setEditor }: { user: AdminUser; editor: EditorState | null; setEditor: (state: EditorState | null) => void; }) => {
	const { message, modal } = AntApp.useApp();
	const queryClient = useQueryClient();
	const staff = useQuery({ queryKey: ['staff'], queryFn: api.staff });
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

	const askReissue = (member: StaffMember) => modal.confirm({
		title: `${member.hasPassword ? 'Сбросить пароль' : 'Выдать новую ссылку'}: ${member.fullName}?`,
		content: member.hasPassword
			? 'Старый пароль перестанет работать, все входы сотрудника завершатся. Вы получите новую ссылку.'
			: 'Прежняя ссылка перестанет работать. Вы получите новую.',
		okText: member.hasPassword ? 'Сбросить' : 'Выдать',
		cancelText: 'Отмена',
		onOk: () => reissue.mutate(member.id),
	});

	const askDisable = (member: StaffMember) => modal.confirm({
		title: `Отключить: ${member.fullName}?`,
		content: 'Доступ закроется сразу на всех устройствах. Сотрудника можно будет включить обратно.',
		okText: 'Отключить',
		okButtonProps: { danger: true },
		cancelText: 'Отмена',
		onOk: () => disable.mutate(member.id),
	});

	// Новая ссылка для просроченного приглашения вынесена кнопкой в строку, в меню остается только отключение
	const moreItems = (member: StaffMember, expired: boolean): MenuProps['items'] => [
		...(expired
			? []
			: [
				{ key: 'reissue', icon: <LockOutlined />, label: member.hasPassword ? 'Сбросить пароль' : 'Новая ссылка', onClick: () => askReissue(member) },
				{ type: 'divider' as const },
			]),
		{ key: 'disable', icon: <StopOutlined />, label: 'Отключить', danger: true, onClick: () => askDisable(member) },
	];

	const columns: TableColumnsType<StaffMember> = [
		{
			title: 'Сотрудник',
			key: 'name',
			render: (_, member) => (
				<div className={member.isActive ? 'person' : 'person off'}>
					<PersonAvatar initials={staffInitials(member.fullName)} seed={member.login} />
					<div>
						<div>{member.fullName} {member.id === user.id && <Tag variant="filled">это вы</Tag>}</div>
						<div className="muted small">{member.login}</div>
					</div>
				</div>
			),
		},
		{ title: 'Роль', dataIndex: 'role', width: 150, render: (role: AdminRole) => <Tag color={ROLE_COLORS[role]}>{ROLE_LABELS[role]}</Tag> },
		{ title: 'Статус', key: 'status', width: 260, render: (_, member) => <StatusBadge member={member} /> },
		{
			title: 'Последний вход',
			dataIndex: 'lastLoginAt',
			width: 160,
			render: (value: string | null) => {
				if (!value) {
					return <span className="muted">—</span>;
				}

				return new Date(value).getTime() > Date.now() - 2 * 86_400_000 ? formatWhen(value) : formatDay(value);
			},
		},
		{
			title: '',
			key: 'actions',
			width: 200,
			render: (_, member) => {
				const self = member.id === user.id;
				const expired = !member.hasPassword && !inviteActive(member);

				return (
					<div className="row-actions">
						<Button size="small" onClick={() => setEditor({ kind: 'edit', member })}>Изменить</Button>
						{!self && !member.isActive && <Button size="small" onClick={() => enable.mutate(member.id)}>Включить</Button>}
						{!self && member.isActive && expired && <Button size="small" onClick={() => askReissue(member)}>Новая ссылка</Button>}
						{!self && member.isActive && (
							<Dropdown
								trigger={['click']}
								menu={{ items: moreItems(member, expired) }}
							>
								<Button size="small" icon={<EllipsisOutlined />} aria-label="Ещё" />
							</Dropdown>
						)}
					</div>
				);
			},
		},
	];

	return (
		<>
			{staff.isError && <Alert className="form-alert" type="error" title={errorText(staff.error)} />}
			<Card className="table-card">
				<Table<StaffMember>
					rowKey="id"
					loading={staff.isPending}
					dataSource={staff.data}
					columns={columns}
					pagination={false}
					scroll={{ x: 860 }}
				/>
			</Card>
			{editor && <StaffEditor state={editor} user={user} onClose={() => setEditor(null)} onInvite={setInvite} />}
			{invite && <InviteModal invite={invite} onClose={() => setInvite(null)} />}
		</>
	);
};

const roleLabel = (value: unknown) => ROLE_LABELS[value as AdminRole] ?? String(value);

const restoreDetails = (details: AuditEntry['details']) => [
	Number(details.changed) > 0 && `изменено разделов: ${Number(details.changed)}`,
	Number(details.returned) > 0 && `вернулось: ${Number(details.returned)}`,
	Number(details.removed) > 0 && `удалено: ${Number(details.removed)}`,
].filter(Boolean).join(', ') || 'только служебные тексты';

const auditDetails = ({ action, details }: AuditEntry) => action === 'content.restore'
	? restoreDetails(details)
	: [
		details.role && `роль: ${roleLabel(details.role)}`,
		details.fromRole && `роль: ${roleLabel(details.fromRole)} → ${roleLabel(details.toRole)}`,
		details.fromName && `ФИО: ${String(details.fromName)} → ${String(details.toName)}`,
		Array.isArray(details.fields) && `поля: ${fieldLabels(details.fields)}`,
		Array.isArray(details.keys) && fieldLabels(details.keys),
		Number(details.removed) > 1 && `вместе с вложенными: ${Number(details.removed) - 1}`,
	].filter(Boolean).join(', ');

const AuditTable = () => {
	const log = useQuery({ queryKey: ['audit-log'], queryFn: api.auditLog });

	const columns: TableColumnsType<AuditEntry> = [
		{ title: 'Когда', dataIndex: 'createdAt', width: 150, render: (value: string) => formatWhen(value) },
		{
			title: 'Кто',
			dataIndex: 'actorName',
			width: 200,
			render: (name: string) => (
				<span className="person small-gap">
					<PersonAvatar initials={staffInitials(name)} seed={name} size="small" />
					{name}
				</span>
			),
		},
		{ title: 'Действие', dataIndex: 'action', render: (action: string) => ACTION_LABELS[action] ?? action },
		{ title: 'Объект', key: 'target', render: (_, entry) => String(entry.details.login ?? entry.details.title ?? '—') },
		{ title: 'Подробности', key: 'details', render: (_, entry) => auditDetails(entry) || '—' },
	];

	return (
		<>
			{log.isError && <Alert className="form-alert" type="error" title={errorText(log.error)} />}
			<Card className="table-card">
				<Table<AuditEntry>
					rowKey="id"
					loading={log.isPending}
					dataSource={log.data}
					columns={columns}
					pagination={{ pageSize: 50, hideOnSinglePage: true }}
					scroll={{ x: 860 }}
				/>
			</Card>
		</>
	);
};

export const StaffPage = ({ user }: { user: AdminUser; }) => {
	const [tab, setTab] = useState('staff');
	const [editor, setEditor] = useState<EditorState | null>(null);

	const add = <Button type="primary" icon={<UserAddOutlined />} onClick={() => setEditor({ kind: 'create' })}>Добавить сотрудника</Button>;

	return (
		<>
			{user.role === 'superadmin'
				? (
					<PageHeader
						title="Сотрудники"
						tabs={[{ key: 'staff', label: 'Сотрудники' }, { key: 'log', label: 'Журнал действий' }]}
						activeTab={tab}
						onTab={setTab}
						tabsExtra={tab === 'staff' ? add : undefined}
					/>
				)
				: <PageHeader title="Сотрудники" extra={add} />}
			<main className="page-body">
				{tab === 'staff' ? <StaffTable user={user} editor={editor} setEditor={setEditor} /> : <AuditTable />}
			</main>
		</>
	);
};
