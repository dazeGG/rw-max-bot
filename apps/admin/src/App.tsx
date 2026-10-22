import { useCallback, useEffect, useState } from 'react';

import type { AdminUser } from '@rw/core';

import { api, UnauthorizedError } from './api';
import { ContentPage } from './ContentPage';
import { LoginPage } from './LoginPage';

type State =
	| { kind: 'loading'; }
	| { kind: 'guest'; }
	| { kind: 'signed-in'; user: AdminUser; }
	| { kind: 'error'; message: string; };

export const App = () => {
	const [state, setState] = useState<State>({ kind: 'loading' });

	useEffect(() => {
		api.me()
			.then(user => setState({ kind: 'signed-in', user }))
			.catch((error: unknown) => setState(error instanceof UnauthorizedError
				? { kind: 'guest' }
				: { kind: 'error', message: error instanceof Error ? error.message : String(error) }));
	}, []);

	const signOut = useCallback(() => setState({ kind: 'guest' }), []);

	const logout = async () => {
		await api.logout();
		setState({ kind: 'guest' });
	};

	switch (state.kind) {
	case 'loading':
		return <div className="center muted">Загрузка…</div>;

	case 'error':
		return <div className="center error">API недоступен: {state.message}</div>;

	case 'guest':
		return <LoginPage onLogin={user => setState({ kind: 'signed-in', user })} />;

	case 'signed-in':
		return (
			<div className="layout">
				<header className="header">
					<span className="brand">ЖДЯ-бот</span>
					<span className="spacer" />
					<span className="muted">{state.user.login}</span>
					<button className="link-button" onClick={() => void logout()}>Выйти</button>
				</header>
				<ContentPage onUnauthorized={signOut} />
			</div>
		);
	}
};
