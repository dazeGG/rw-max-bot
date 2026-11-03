import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Form } from 'antd';
import { useNavigate, useParams } from 'react-router';

import { api } from './api';
import { PasswordFields } from './PasswordFields';
import { errorText, signedIn } from './session';

export const InvitePage = () => {
	const { token = '' } = useParams();
	const navigate = useNavigate();

	const invite = useQuery({ queryKey: ['invite', token], queryFn: () => api.invite(token), retry: false, refetchOnWindowFocus: false });

	const accept = useMutation({
		mutationFn: (password: string) => api.acceptInvite(token, { password }),
		onSuccess: user => {
			signedIn(user);
			void navigate('/', { replace: true });
		},
	});

	if (invite.isPending) {
		return <div className="center muted">Загрузка…</div>;
	}

	if (invite.isError) {
		return <div className="center error">{errorText(invite.error)}</div>;
	}

	return (
		<div className="center">
			<Card className="auth-card">
				<div className="auth-head">
					<img src="/logo.png" alt="Логотип АО «АК «ЖДЯ»" />
					<h1>Задайте пароль</h1>
					<div className="muted">{invite.data.fullName}, ваш логин для входа: <b>{invite.data.login}</b></div>
				</div>
				<Form<{ password: string; }> layout="vertical" size="large" requiredMark={false} onFinish={values => accept.mutate(values.password)}>
					<PasswordFields />
					{accept.isError && <Alert className="form-alert" type="error" title={errorText(accept.error)} />}
					<Button type="primary" htmlType="submit" block loading={accept.isPending}>Сохранить и войти</Button>
				</Form>
			</Card>
		</div>
	);
};
