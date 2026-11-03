import { CustomerServiceOutlined, FileTextOutlined, LogoutOutlined, QuestionCircleOutlined, SettingOutlined, TeamOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Layout, Menu, Tooltip } from 'antd';
import { useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router';

import type { AdminUser } from '@rw/core';

import { AccountPage } from './AccountPage';
import { api } from './api';
import { ContentPage } from './ContentPage';
import { InvitePage } from './InvitePage';
import { LoginPage } from './LoginPage';
import { PersonAvatar, staffInitials } from './page';
import { QuestionsPage } from './QuestionsPage';
import { errorText, isManager, QUESTIONS_KEY, ROLE_LABELS, signedOut, useMe } from './session';
import { SettingsPage } from './SettingsPage';
import { StaffPage } from './StaffPage';
import { SupportPage, useSupportFeed } from './SupportPage';

const SIDER_WIDTH = 232;

const MenuLabel = ({ to, title, count }: { to: string; title: string; count?: number; }) => (
	<span className="menu-label">
		<Link to={to}>{title}</Link>
		{Boolean(count) && <Badge count={count} overflowCount={999} />}
	</span>
);

const Shell = ({ user }: { user: AdminUser; }) => {
	const { pathname } = useLocation();
	const [collapsed, setCollapsed] = useState(false);
	const waiting = useSupportFeed(user);
	const manager = isManager(user.role);
	const questions = useQuery({ queryKey: QUESTIONS_KEY, queryFn: api.questions, enabled: manager });

	const logout = async () => {
		await api.logout();
		signedOut();
	};

	const support = {
		key: 'support',
		icon: <CustomerServiceOutlined />,
		label: <MenuLabel to="/support" title="Чат поддержки" count={waiting} />,
	};

	const items = manager
		? [
			{ key: 'content', icon: <FileTextOutlined />, label: <MenuLabel to="/content" title="Контент" /> },
			{ key: 'questions', icon: <QuestionCircleOutlined />, label: <MenuLabel to="/questions" title="Вопросы" count={questions.data?.length} /> },
			support,
			{ key: 'settings', icon: <SettingOutlined />, label: <MenuLabel to="/settings" title="Настройки" /> },
			{ key: 'staff', icon: <TeamOutlined />, label: <MenuLabel to="/staff" title="Сотрудники" /> },
		]
		: [support];

	return (
		<Layout className="app">
			<Layout.Sider
				className="app-sider"
				theme="light"
				width={SIDER_WIDTH}
				collapsible
				collapsed={collapsed}
				breakpoint="lg"
				onCollapse={setCollapsed}
			>
				<Link className="app-logo" to="/">
					<img src="/logo.png" alt="" />
					{!collapsed && 'ЖДЯ-бот'}
				</Link>
				<Menu className="app-menu" mode="inline" selectedKeys={[pathname.split('/')[1]]} items={items} />
				<div className="app-user">
					<Link to="/account" aria-label="Профиль">
						<PersonAvatar initials={staffInitials(user.fullName)} seed={user.login} />
					</Link>
					{!collapsed && (
						<Link className="app-user-name" to="/account">
							<div>{user.fullName}</div>
							<div className="muted small">{ROLE_LABELS[user.role]}</div>
						</Link>
					)}
					{!collapsed && (
						<Tooltip title="Выйти">
							<Button type="text" icon={<LogoutOutlined />} aria-label="Выйти" onClick={() => void logout()} />
						</Tooltip>
					)}
				</div>
			</Layout.Sider>
			<div className="app-main">
				<Routes>
					{manager && (
						<>
							<Route path="/content/:nodeId?" element={<ContentPage user={user} />} />
							<Route path="/questions" element={<QuestionsPage />} />
							<Route path="/settings" element={<SettingsPage />} />
							<Route path="/staff" element={<StaffPage user={user} />} />
						</>
					)}
					<Route path="/support/:ticketId?" element={<SupportPage user={user} />} />
					<Route path="/account" element={<AccountPage user={user} />} />
					<Route path="*" element={<Navigate to={manager ? '/content' : '/support'} replace />} />
				</Routes>
			</div>
		</Layout>
	);
};

const SignedInArea = () => {
	const me = useMe();

	if (me.isPending) {
		return <div className="center muted">Загрузка…</div>;
	}

	if (me.isError) {
		return <div className="center error">API недоступен: {errorText(me.error)}</div>;
	}

	return me.data ? <Shell user={me.data} /> : <LoginPage />;
};

export const App = () => (
	<Routes>
		<Route path="/invite/:token" element={<InvitePage />} />
		<Route path="*" element={<SignedInArea />} />
	</Routes>
);
