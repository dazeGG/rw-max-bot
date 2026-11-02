import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, App, Button, Form, Input, Modal, Select, Table, Tabs, Tag } from 'antd';
import type { TableColumnsType } from 'antd';
import { useMemo, useState } from 'react';

import type { ContentVersionEntry, SettingKey, Settings } from '@rw/core';

import { api, ConflictError } from './api';
import { ApplyStatus, useApply } from './apply-status';
import { buildTree, pathOf } from './content-tree';
import { ACTION_LABELS, fieldLabels, formatDate, SETTING_LABELS } from './labels';
import { MessageEditor } from './MessageEditor';
import { CONTENT_KEY, errorText, queryClient } from './session';
import { useUnsavedGuard } from './unsaved';

const VERSIONS_KEY = ['content-versions'];

// Сколько названий разделов показать в подтверждении возврата
const NAMES_SHOWN = 10;

const MESSAGES: { key: SettingKey; hint: string; }[] = [
	{ key: 'text.greeting', hint: 'Отправляется перед ответом, когда пассажир поздоровался.' },
	{ key: 'text.didYouMean', hint: 'Бот не уверен, что понял вопрос. Варианты он добавит сам.' },
	{ key: 'text.fallback', hint: 'Бот не нашел ответа. Темы главного меню он добавит сам.' },
	{ key: 'text.anythingElse', hint: 'Отдельное сообщение после ответа.' },
	{ key: 'text.askMore', hint: 'Пассажир ответил, что у него есть еще вопрос. Темы главного меню бот добавит сам.' },
	{ key: 'text.goodbye', hint: 'Пассажир ответил, что вопросов больше нет.' },
];

const TextsForm = ({ settings, onSaved, onRefresh }: { settings: Settings; onSaved: () => Promise<void>; onRefresh: () => void; }) => {
	const [form] = Form.useForm<Settings>();
	const { message } = App.useApp();
	const watched = Form.useWatch([], form) as Partial<Settings> | undefined;
	const values: Settings = { ...settings, ...watched };
	const changedKeys = (Object.keys(settings) as SettingKey[]).filter(key => values[key] !== settings[key]);
	const dirty = changedKeys.length > 0;
	const { modal } = useUnsavedGuard(dirty, 'Если уйти сейчас, изменения в текстах пропадут.');

	const content = useQuery({ queryKey: CONTENT_KEY, queryFn: api.content, refetchOnWindowFocus: false });

	const sections = useMemo(() => {
		const tree = buildTree(content.data?.nodes ?? []);

		return [...tree.byId.values()]
			.filter(node => node.parentId !== null)
			.map(node => ({ value: node.code, label: pathOf(tree, node) }))
			.sort((a, b) => a.label.localeCompare(b.label, 'ru'));
	}, [content.data]);

	const save = useMutation({
		mutationFn: () => api.updateSettings({
			changes: changedKeys.map(key => ({ key, value: values[key], previous: settings[key] })),
		}),
		onSuccess: async () => {
			message.success('Тексты сохранены');
			await onSaved();
		},
	});

	const handoff = settings['search.handoff'];
	const handoffLost = handoff !== '' && content.data !== undefined && !sections.some(section => section.value === handoff);

	return (
		<Form form={form} className="settings-form" layout="vertical" initialValues={settings} onFinish={() => save.mutate()}>
			{MESSAGES.map(({ key, hint }) => (
				<Form.Item
					key={key}
					name={key}
					label={SETTING_LABELS[key]}
					extra={hint}
					rules={[{ required: true, whitespace: true, message: 'Текст не может быть пустым' }]}
				>
					<MessageEditor />
				</Form.Item>
			))}

			<Form.Item
				name="text.handoff"
				label={SETTING_LABELS['text.handoff']}
				extra="Последний пункт каждого уточнения поиска."
				rules={[{ required: true, whitespace: true, message: 'Введите название пункта' }]}
			>
				<Input maxLength={200} />
			</Form.Item>

			<Form.Item
				name="search.handoff"
				label={SETTING_LABELS['search.handoff']}
				extra="Если раздел выключен, пункта тоже не будет."
			>
				<Select
					options={[{ value: '', label: 'Не показывать пункт' }, ...sections]}
					showSearch={{ optionFilterProp: 'label' }}
				/>
			</Form.Item>

			{handoffLost && <Alert className="form-alert" type="warning" title="Раздел, куда ведет этот пункт, не найден: сейчас пункта нет. Выберите другой раздел." />}

			{save.isError && (
				<Alert
					className="form-alert"
					type="error"
					title={errorText(save.error)}
					action={save.error instanceof ConflictError ? <Button size="small" onClick={onRefresh}>Обновить</Button> : undefined}
					description={save.error instanceof ConflictError ? 'После обновления ваши несохраненные правки пропадут: скопируйте их, если они нужны.' : undefined}
				/>
			)}

			<div className="form-bar">
				<Button type="primary" htmlType="submit" disabled={!dirty} loading={save.isPending}>Сохранить</Button>
				{dirty && <span className="muted">Есть несохраненные правки</span>}
			</div>

			{modal}
		</Form>
	);
};

const NameList = ({ title, names }: { title: string; names: string[]; }) => names.length === 0
	? null
	: (
		<>
			<p>{title}: {names.length}</p>
			<ul>
				{names.slice(0, NAMES_SHOWN).map((name, index) => <li key={`${index}:${name}`}>{name}</li>)}
				{names.length > NAMES_SHOWN && <li className="muted">и еще {names.length - NAMES_SHOWN}</li>}
			</ul>
		</>
	);

const RestoreModal = ({ entry, onRestored, onClose }: { entry: ContentVersionEntry; onRestored: () => Promise<void>; onClose: () => void; }) => {
	const diff = useQuery({
		queryKey: ['content-version', entry.version],
		queryFn: () => api.contentVersionDiff(entry.version),
		gcTime: 0,
	});

	const restore = useMutation({
		mutationFn: () => api.restoreContentVersion(entry.version),
		onSuccess: onRestored,
	});

	const empty = diff.data
		&& diff.data.changed.length + diff.data.returned.length + diff.data.removed.length + diff.data.settings === 0;

	return (
		<Modal
			open
			title={`Вернуть контент к версии от ${formatDate(entry.createdAt)}?`}
			okText="Вернуть"
			okButtonProps={{ danger: true, disabled: !diff.data || empty, loading: restore.isPending }}
			cancelText="Отмена"
			onOk={() => restore.mutate()}
			onCancel={onClose}
		>
			<p>Все разделы и служебные тексты станут такими, как в этой версии. Текущая версия останется в истории: к ней можно будет вернуться.</p>
			{diff.isPending && <p className="muted">Сравниваем с текущим контентом…</p>}
			{diff.isError && <Alert type="error" title={errorText(diff.error)} />}
			{empty && <p className="muted">Эта версия не отличается от текущего контента.</p>}
			{diff.data && (
				<>
					<NameList title="Изменятся разделы" names={diff.data.changed} />
					<NameList title="Вернутся удаленные разделы" names={diff.data.returned} />
					<NameList title="Удалятся разделы, которых тогда не было" names={diff.data.removed} />
					{diff.data.settings > 0 && <p>Изменятся служебные тексты: {diff.data.settings}</p>}
				</>
			)}
			{restore.isError && <Alert type="error" title={errorText(restore.error)} />}
		</Modal>
	);
};

const describeEntry = (entry: ContentVersionEntry) => {
	if (!entry.action) {
		return <span className="muted">Изменение вне админки или начальная версия</span>;
	}

	const action = ACTION_LABELS[entry.action] ?? entry.action;
	const fields = fieldLabels(entry.fields);

	return `${action}: ${entry.title ?? '—'}${fields && ` (${fields})`}`;
};

const HistoryTab = ({ onRestored }: { onRestored: () => Promise<void>; }) => {
	const { message } = App.useApp();
	const versions = useQuery({ queryKey: VERSIONS_KEY, queryFn: api.contentVersions });
	const [restoring, setRestoring] = useState<ContentVersionEntry | null>(null);

	const columns: TableColumnsType<ContentVersionEntry> = [
		{ title: 'Когда', dataIndex: 'createdAt', render: (value: string) => formatDate(value) },
		{ title: 'Кто', dataIndex: 'actorName', render: (value: string | null) => value ?? '—' },
		{ title: 'Что изменилось', key: 'what', render: (_, entry) => describeEntry(entry) },
		{
			title: '',
			key: 'action',
			align: 'right',
			render: (_, entry) => {
				if (entry.current) {
					return <Tag color="success">Текущая</Tag>;
				}

				return entry.restorable ? <Button size="small" onClick={() => setRestoring(entry)}>Вернуть</Button> : null;
			},
		},
	];

	return (
		<>
			<p className="muted">Последние изменения контента и служебных текстов. Кнопка «Вернуть» возвращает весь контент к состоянию после этого изменения.</p>
			{versions.isError && <Alert className="form-alert" type="error" title={errorText(versions.error)} />}
			<Table<ContentVersionEntry>
				rowKey="id"
				size="middle"
				loading={versions.isPending}
				dataSource={versions.data}
				columns={columns}
				pagination={{ pageSize: 20, hideOnSinglePage: true }}
				scroll={{ x: 'max-content' }}
			/>
			{restoring && (
				<RestoreModal
					entry={restoring}
					onClose={() => setRestoring(null)}
					onRestored={async () => {
						setRestoring(null);
						message.success('Контент возвращен к выбранной версии');
						await onRestored();
					}}
				/>
			)}
		</>
	);
};

export const SettingsPage = () => {
	const { status, apply } = useApply();
	const content = useQuery({ queryKey: CONTENT_KEY, queryFn: api.content, refetchOnWindowFocus: false });

	const refresh = () => queryClient.invalidateQueries({ queryKey: CONTENT_KEY });

	const saved = async () => {
		await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: VERSIONS_KEY })]);
		apply();
	};

	if (content.isError) {
		return <div className="center error">{errorText(content.error)}</div>;
	}

	if (!content.data) {
		return <div className="center muted">Загрузка настроек…</div>;
	}

	const { settings } = content.data;

	return (
		<main className="page">
			<ApplyStatus status={status} />
			<Tabs
				items={[
					{
						key: 'texts',
						label: 'Служебные тексты',
						// Форма заново монтируется от новых значений: после сохранения, обновления или возврата версии
						children: <TextsForm key={JSON.stringify(settings)} settings={settings} onSaved={saved} onRefresh={() => void refresh()} />,
					},
					{
						key: 'history',
						label: 'История версий',
						children: <HistoryTab onRestored={saved} />,
					},
				]}
			/>
		</main>
	);
};
