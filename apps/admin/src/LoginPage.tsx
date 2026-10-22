import { useState } from 'react';
import type { FormEvent } from 'react';

import type { AdminUser } from '@rw/core';

import { api } from './api';

export const LoginPage = ({ onLogin }: { onLogin: (user: AdminUser) => void; }) => {
	const [login, setLogin] = useState('');
	const [password, setPassword] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		setPending(true);
		setError(null);

		try {
			onLogin(await api.login({ login, password }));
		} catch (loginError) {
			setError(loginError instanceof Error ? loginError.message : String(loginError));
		} finally {
			setPending(false);
		}
	};

	return (
		<div className="center">
			<form className="login" onSubmit={event => void submit(event)}>
				<h1>ЖДЯ-бот</h1>
				<label>
					Логин
					<input value={login} onChange={event => setLogin(event.target.value)} autoComplete="username" autoFocus required />
				</label>
				<label>
					Пароль
					<input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required />
				</label>
				{error && <div className="error">{error}</div>}
				<button type="submit" disabled={pending}>{pending ? 'Вход…' : 'Войти'}</button>
			</form>
		</div>
	);
};
