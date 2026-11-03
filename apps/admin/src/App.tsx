import { Button, Menu } from 'antd';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router';

import type { AdminUser } from '@rw/core';

import { AccountPage } from './AccountPage';
import { api } from './api';
import { ContentPage } from './ContentPage';
import { InvitePage } from './InvitePage';
import { LoginPage } from './LoginPage';
import { QuestionsPage } from './QuestionsPage';
import { SupportPage, useSupportFeed } from './SupportPage';
import { errorText, isManager, signedOut, useMe } from './session';
import { SettingsPage } from './SettingsPage';
import { StaffPage } from './StaffPage';

const Shell = ({ user }: { user: AdminUser; }) => {
	const { pathname } = useLocation();
	const counts = useSupportFeed(user);
	const manager = isManager(user.role);

	const logout = async () => {
		await api.logout();
		signedOut();
	};

	const items = [
		...manager
			? [
				{ key: 'content', label: <Link to="/content">Контент</Link> },
				{ key: 'questions', label: <Link to="/questions">Вопросы</Link> },
				{ key: 'settings', label: <Link to="/settings">Настройки</Link> },
				{ key: 'staff', label: <Link to="/staff">Сотрудники</Link> },
			]
			: [],
		{ key: 'support', label: <Link to="/support">Чат{counts ? ` (${counts})` : ''}</Link> },
	];

	return (
		<div className="layout">
			<header className="header">
				<span className="brand">ЖДЯ-бот</span>
				<Menu className="nav" mode="horizontal" selectedKeys={[pathname.split('/')[1]]} items={items} />
				<Link to="/account">{user.fullName}</Link>
				<Button type="link" onClick={() => void logout()}>Выйти</Button>
			</header>
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
