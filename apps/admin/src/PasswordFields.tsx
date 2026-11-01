import { Form, Input } from 'antd';

// Как в API (MIN_PASSWORD_LENGTH): здесь — чтобы подсказать сразу, а не после запроса
const MIN_PASSWORD_LENGTH = 8;

export const PasswordFields = () => (
	<>
		<Form.Item
			name="password"
			label="Новый пароль"
			rules={[
				{ required: true, message: 'Введите пароль' },
				{ min: MIN_PASSWORD_LENGTH, message: `Не короче ${MIN_PASSWORD_LENGTH} символов` },
			]}
		>
			<Input.Password autoComplete="new-password" />
		</Form.Item>
		<Form.Item
			name="repeat"
			label="Пароль еще раз"
			dependencies={['password']}
			rules={[
				{ required: true, message: 'Повторите пароль' },
				({ getFieldValue }) => ({
					validator: (_, value) => value === getFieldValue('password')
						? Promise.resolve()
						: Promise.reject(new Error('Пароли не совпадают')),
				}),
			]}
		>
			<Input.Password autoComplete="new-password" />
		</Form.Item>
	</>
);
