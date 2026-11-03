// «Мои шаблоны»: заготовки ответов сотрудника. В ответе их находят по косой черте или кнопке «Шаблоны»

import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, App, Button, Card, Drawer, Form, Input, Space, Tooltip } from 'antd';
import { useState } from 'react';

import type { SupportTemplate, SupportTemplateRequest } from '@rw/core';

import { api } from './api';
import { errorText, queryClient } from './session';

export const TEMPLATES_KEY = ['support-templates'];
export const TEMPLATE_TEXT_LIMIT = 3900;

const DRAWER_WIDTH = 520;

export const useTemplates = () => useQuery({ queryKey: TEMPLATES_KEY, queryFn: api.supportTemplates });

const refresh = () => queryClient.invalidateQueries({ queryKey: TEMPLATES_KEY });

type EditorProps = {
	template: SupportTemplate | null;
	onClose: () => void;
};

const TemplateForm = ({ template, onClose }: EditorProps) => {
	const save = useMutation({
		mutationFn: (values: SupportTemplateRequest) => template
			? api.updateSupportTemplate(template.id, values)
			: api.createSupportTemplate(values),
		onSuccess: async () => {
			await refresh();
			onClose();
		},
	});

	return (
		<Card className="template-form">
			<Form<SupportTemplateRequest> layout="vertical" initialValues={template ?? undefined} onFinish={values => save.mutate(values)}>
				<Form.Item name="title" label="Название" rules={[{ required: true, whitespace: true, message: 'Введите название' }]}>
					<Input autoFocus maxLength={100} />
				</Form.Item>
				<Form.Item label="Команда" required extra="Без пробелов. Её набирают после /, чтобы быстро найти шаблон.">
					<Space.Compact block>
						<Space.Addon>/</Space.Addon>
						<Form.Item
							name="command"
							noStyle
							rules={[
								{ required: true, message: 'Введите команду' },
								{ pattern: /^[^\s/]+$/, message: 'Без пробелов и косых черт' },
							]}
						>
							<Input maxLength={50} autoComplete="off" />
						</Form.Item>
					</Space.Compact>
				</Form.Item>
				<Form.Item name="text" label="Текст ответа" rules={[{ required: true, whitespace: true, message: 'Введите текст' }]}>
					<Input.TextArea autoSize={{ minRows: 4, maxRows: 10 }} maxLength={TEMPLATE_TEXT_LIMIT} showCount />
				</Form.Item>
				{save.isError && <Alert className="form-alert" type="error" title={errorText(save.error)} />}
				<div className="row-actions">
					<Button type="primary" htmlType="submit" loading={save.isPending}>Сохранить</Button>
					<Button onClick={onClose}>Отмена</Button>
				</div>
			</Form>
		</Card>
	);
};

type Editing = { template: SupportTemplate | null; } | null;

export const TemplatesDrawer = ({ open, onClose }: { open: boolean; onClose: () => void; }) => {
	const { message, modal } = App.useApp();
	const templates = useTemplates();
	const [search, setSearch] = useState('');
	const [editing, setEditing] = useState<Editing>(null);

	const remove = useMutation({
		mutationFn: api.deleteSupportTemplate,
		onError: error => void message.error(errorText(error)),
		onSettled: refresh,
	});

	const needle = search.trim().toLowerCase();
	const shown = (templates.data ?? []).filter(({ title, command, text }) => !needle || `${title} ${command} ${text}`.toLowerCase().includes(needle));

	return (
		<Drawer
			open={open}
			size={DRAWER_WIDTH}
			title="Мои шаблоны"
			extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing({ template: null })}>Новый шаблон</Button>}
			onClose={onClose}
		>
			<div className="templates">
				<div className="muted">Шаблоны видны только вам. В ответе наберите / и начало команды или нажмите «Шаблоны».</div>
				<Input.Search allowClear placeholder="Найти шаблон" value={search} onChange={event => setSearch(event.target.value)} />
				{templates.isError && <Alert type="error" title={errorText(templates.error)} />}
				{editing && <TemplateForm key={editing.template?.id ?? 'new'} template={editing.template} onClose={() => setEditing(null)} />}
				{templates.data?.length === 0 && !editing && <p className="muted">Шаблонов пока нет.</p>}
				{shown.map(template => (
					<Card key={template.id} size="small" className="template-card">
						<div className="template-body">
							<div className="template-head">
								<b>{template.title}</b>
								<code>/{template.command}</code>
							</div>
							<div className="template-text secondary">{template.text}</div>
						</div>
						<Tooltip title="Изменить">
							<Button size="small" type="text" icon={<EditOutlined />} aria-label="Изменить" onClick={() => setEditing({ template })} />
						</Tooltip>
						<Tooltip title="Удалить">
							<Button
								size="small"
								type="text"
								icon={<DeleteOutlined />}
								aria-label="Удалить"
								onClick={() => modal.confirm({
									title: `Удалить шаблон «${template.title}»?`,
									okText: 'Удалить',
									okButtonProps: { danger: true },
									cancelText: 'Отмена',
									onOk: () => remove.mutate(template.id),
								})}
							/>
						</Tooltip>
					</Card>
				))}
			</div>
		</Drawer>
	);
};
