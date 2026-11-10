import { ExclamationCircleFilled } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Anchor, App, Badge, Button, Card, Checkbox, Form, Input, Modal, Select, Table, Tag } from 'antd';
import type { TableColumnsType } from 'antd';
import { useMemo, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';

import type { ContentVersionEntry, SettingKey, Settings } from '@rw/core';

import { api, ConflictError } from './api';
import { ApplyStatus, useApply } from './apply-status';
import { buildTree, pathOf } from './content-tree';
import { ACTION_LABELS, fieldLabels, formatWhen, plural, SETTING_LABELS } from './labels';
import { MessageEditor } from './MessageEditor';
import { PageHeader, PersonAvatar, staffInitials } from './page';
import { CONTENT_KEY, errorText, queryClient } from './session';
import { useUnsavedGuard } from './unsaved';

const VERSIONS_KEY = ['content-versions'];

// Сколько названий разделов показать в подтверждении возврата
const NAMES_SHOWN = 10;

const TIME_RULE = { pattern: /^([01]\d|2[0-3]):[0-5]\d$/, message: 'Например: 08:00' };

const GROUPS = [
	{ id: 'dialog', title: 'Начало и конец диалога' },
	{ id: 'unsure', title: 'Когда бот не уверен' },
	{ id: 'support', title: 'Чат поддержки' },
];

const WEEK_DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((label, index) => ({ label, value: String(index + 1) }));

// В настройках дни хранятся строкой: «1,2,3»
const DaysField = ({ value = '', onChange }: { value?: string; onChange?: (value: string) => void; }) => (
	<Checkbox.Group
		options={WEEK_DAYS}
		value={value.split(',').filter(Boolean)}
		onChange={days => onChange?.([...days].sort().join(','))}
	/>
);

const Row = ({ label, hint, required = true, children }: { label: string; hint: string; required?: boolean; children: ReactNode; }) => (
	<div className="text-row">
		<div className="text-row-label">
			<div className={required ? 'required-mark' : undefined}>{label}</div>
			<div className="muted">{hint}</div>
		</div>
		<div className="text-row-field">{children}</div>
	</div>
);

const TextRow = ({ name, hint }: { name: SettingKey; hint: string; }) => (
	<Row label={SETTING_LABELS[name]} hint={hint}>
		<Form.Item name={name} rules={[{ required: true, whitespace: true, message: 'Текст не может быть пустым' }]}>
			<MessageEditor compact />
		</Form.Item>
	</Row>
);

const changesText = (keys: SettingKey[]) => keys.length === 1
	? `Изменён 1 текст: «${SETTING_LABELS[keys[0]]}»`
	: `Изменено ${keys.length} ${plural(keys.length, ['текст', 'текста', 'текстов'])}`;

type TextsFormProps = {
	settings: Settings;
	scroller: RefObject<HTMLElement | null>;
	onSaved: () => Promise<void>;
	onRefresh: () => void;
};

const TextsForm = ({ settings, scroller, onSaved, onRefresh }: TextsFormProps) => {
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
		<div className="settings">
			<Form form={form} className="settings-form" layout="vertical" initialValues={settings} onFinish={() => save.mutate()}>
				<Card id="dialog" title={GROUPS[0].title}>
					<TextRow name="text.greeting" hint="Перед ответом, когда пассажир поздоровался." />
					<TextRow name="text.anythingElse" hint="Отдельное сообщение после конечного ответа." />
					<TextRow name="text.askMore" hint="Темы главного меню бот добавит сам." />
					<TextRow name="text.goodbye" hint="Пассажир ответил, что вопросов больше нет." />
				</Card>

				<Card id="unsure" title={GROUPS[1].title}>
					<TextRow name="text.didYouMean" hint="Бот не уверен, что понял. Варианты добавит сам." />
					<TextRow name="text.fallback" hint="Ответа нет. Темы главного меню бот добавит сам." />
					<Row label={SETTING_LABELS['text.handoff']} hint="Последний пункт каждого уточнения.">
						<Form.Item name="text.handoff" rules={[{ required: true, whitespace: true, message: 'Введите название пункта' }]}>
							<Input maxLength={200} />
						</Form.Item>
						<div className="handoff-target">
							<span className="secondary">Ведёт в раздел</span>
							<Form.Item name="search.handoff" noStyle>
								<Select
									aria-label={SETTING_LABELS['search.handoff']}
									options={[{ value: '', label: 'Не показывать пункт' }, ...sections]}
									showSearch={{ optionFilterProp: 'label' }}
								/>
							</Form.Item>
						</div>
						<div className="muted">Если раздел выключен, пункта тоже не будет.</div>
						{handoffLost && <Alert type="warning" title="Раздел, куда ведет этот пункт, не найден: сейчас пункта нет. Выберите другой раздел." />}
					</Row>
					<Row label={SETTING_LABELS['text.handoffOperator']} hint="Когда чат поддержки включён, последний пункт уточнения ведёт сразу к оператору.">
						<Form.Item name="text.handoffOperator" rules={[{ required: true, whitespace: true, message: 'Введите название пункта' }]}>
							<Input maxLength={200} />
						</Form.Item>
					</Row>
				</Card>

				<Card id="support" title={GROUPS[2].title}>
					<TextRow name="text.supportQueued" hint="Пассажир выбрал «Написать оператору» в рабочее время." />
					<TextRow name="text.supportOffHours" hint="То же в нерабочее время. Вместо {next} бот подставит, когда ответят: «завтра с 8:00»." />
					<TextRow name="text.supportClosed" hint="Сотрудник закрыл обращение или пассажир не отвечал 24 часа." />
					<TextRow name="text.supportCancelled" hint="Пассажир передумал, пока обращение ждало в очереди. Следом бот покажет главное меню." />
					<Row label="Часы работы поддержки" hint="По якутскому времени. Обращения принимаются круглосуточно, в нерабочее время пассажир узнает, когда ему ответят." required={false}>
						<div className="support-hours">
							<Form.Item name="support.open" label="Начало" rules={[TIME_RULE]}>
								<Input maxLength={5} />
							</Form.Item>
							<Form.Item name="support.close" label="Конец" rules={[TIME_RULE]}>
								<Input maxLength={5} />
							</Form.Item>
						</div>
						<Form.Item name="support.days" label="Рабочие дни">
							<DaysField />
						</Form.Item>
					</Row>
				</Card>

				{/* Ошибка у панели сохранения: форма длинная, и в конце формы ее бы не увидели */}
				<div className="form-footer">
					{save.isError && (
						<Alert
							type="error"
							title={errorText(save.error)}
							action={save.error instanceof ConflictError ? <Button size="small" onClick={onRefresh}>Обновить</Button> : undefined}
							description={save.error instanceof ConflictError ? 'После обновления ваши несохраненные правки пропадут: скопируйте их, если они нужны.' : undefined}
						/>
					)}

					<div className="form-bar floating">
						<Button type="primary" htmlType="submit" disabled={!dirty} loading={save.isPending}>Сохранить</Button>
						{dirty && (
							<>
								<Button onClick={() => form.resetFields()}>Отменить правки</Button>
								<Badge status="warning" text={changesText(changedKeys)} />
							</>
						)}
					</div>
				</div>

				{modal}
			</Form>

			<nav className="settings-anchor" aria-label="Группы текстов">
				<Anchor
					affix={false}
					targetOffset={16}
					getContainer={() => scroller.current ?? window}
					items={GROUPS.map(({ id, title }) => ({ key: id, href: `#${id}`, title }))}
					onClick={event => event.preventDefault()}
				/>
			</nav>
		</div>
	);
};

const sectionsWord = (count: number) => `${count} ${plural(count, ['раздел', 'раздела', 'разделов'])}`;

const DiffBlock = ({ tag, color, note, names }: { tag: string; color: string; note: string; names: string[]; }) => names.length === 0
	? null
	: (
		<div className="diff-block">
			<div className="diff-head">
				<Tag color={color}>{tag}</Tag>
				<span className="muted">{note}</span>
			</div>
			<div>
				{names.slice(0, NAMES_SHOWN).join(', ')}
				{names.length > NAMES_SHOWN && <span className="muted"> и ещё {names.length - NAMES_SHOWN}</span>}
			</div>
		</div>
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
			title={(
				<span className="restore-title">
					<ExclamationCircleFilled className="warning-icon" />
					Вернуть контент к версии от {formatWhen(entry.createdAt)}?
				</span>
			)}
			okText="Вернуть"
			okButtonProps={{ danger: true, disabled: !diff.data || empty, loading: restore.isPending }}
			cancelText="Отмена"
			onOk={() => restore.mutate()}
			onCancel={onClose}
		>
			<p className="secondary">Все разделы и служебные тексты станут такими, как в этой версии. Текущую версию можно будет вернуть из истории.</p>
			{diff.isPending && <p className="muted">Сравниваем с текущим контентом…</p>}
			{diff.isError && <Alert type="error" title={errorText(diff.error)} />}
			{empty && <p className="muted">Эта версия не отличается от текущего контента.</p>}
			{diff.data && (
				<>
					<DiffBlock tag="Изменятся" color="processing" note={sectionsWord(diff.data.changed.length)} names={diff.data.changed} />
					<DiffBlock tag="Вернутся" color="success" note={`${sectionsWord(diff.data.returned.length)} из удалённых`} names={diff.data.returned} />
					<DiffBlock tag="Удалятся" color="error" note={`${sectionsWord(diff.data.removed.length)}, которых тогда не было`} names={diff.data.removed} />
					{diff.data.settings > 0 && (
						<div className="diff-block">
							<div className="diff-head">
								<Tag color="orange">Тексты</Tag>
								<span className="muted">изменятся служебные тексты: {diff.data.settings}</span>
							</div>
						</div>
					)}
				</>
			)}
			{restore.isError && <Alert type="error" title={errorText(restore.error)} />}
		</Modal>
	);
};

const ACTION_COLORS: Record<string, string> = {
	'content.update': 'processing',
	'content.create': 'success',
	'content.move': 'purple',
	'settings.update': 'orange',
	'content.delete': 'error',
	'content.restore': 'cyan',
};

const WhatChanged = ({ entry }: { entry: ContentVersionEntry; }) => {
	if (!entry.action) {
		return <span className="muted">Изменение вне админки или начальная версия</span>;
	}

	const fields = fieldLabels(entry.fields);

	return (
		<div className="what-changed">
			<Tag color={ACTION_COLORS[entry.action]}>{ACTION_LABELS[entry.action] ?? entry.action}</Tag>
			{entry.title && <span>{entry.title}</span>}
			{fields && <span className="muted">{fields}</span>}
		</div>
	);
};

const HistoryTab = ({ onRestored }: { onRestored: () => Promise<void>; }) => {
	const { message } = App.useApp();
	const versions = useQuery({ queryKey: VERSIONS_KEY, queryFn: api.contentVersions });
	const [restoring, setRestoring] = useState<ContentVersionEntry | null>(null);

	const columns: TableColumnsType<ContentVersionEntry> = [
		{ title: 'Когда', dataIndex: 'createdAt', width: 150, render: (value: string) => <span className="secondary">{formatWhen(value)}</span> },
		{
			title: 'Кто',
			dataIndex: 'actorName',
			width: 220,
			render: (name: string | null) => name
				? (
					<span className="person small-gap">
						<PersonAvatar initials={staffInitials(name)} seed={name} size="small" />
						{name}
					</span>
				)
				: <span className="muted">—</span>,
		},
		{ title: 'Что изменилось', key: 'what', render: (_, entry) => <WhatChanged entry={entry} /> },
		{
			title: '',
			key: 'action',
			width: 120,
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
		<div className="page-stack">
			<Alert type="info" showIcon title="«Вернуть» возвращает весь контент и служебные тексты к состоянию после выбранного изменения. Текущая версия останется в истории." />
			{versions.isError && <Alert type="error" title={errorText(versions.error)} />}
			<Card className="table-card">
				<Table<ContentVersionEntry>
					rowKey="id"
					loading={versions.isPending}
					dataSource={versions.data}
					columns={columns}
					pagination={{ pageSize: 20, hideOnSinglePage: true }}
					scroll={{ x: 860 }}
				/>
			</Card>
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
		</div>
	);
};

export const SettingsPage = () => {
	const { status, appliedAt, apply } = useApply();
	const [tab, setTab] = useState('texts');
	const scroller = useRef<HTMLElement>(null);
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
		<>
			<PageHeader
				title="Настройки"
				extra={<ApplyStatus status={status} appliedAt={appliedAt} />}
				tabs={[{ key: 'texts', label: 'Служебные тексты' }, { key: 'history', label: 'История версий' }]}
				activeTab={tab}
				onTab={setTab}
			/>
			<main ref={scroller} className="page-body">
				{/* Форма остается на странице при смене вкладки, чтобы не терять правки. Заново монтируется от новых значений: после сохранения, обновления или возврата версии */}
				<div className="settings-texts" hidden={tab !== 'texts'}>
					<TextsForm key={JSON.stringify(settings)} settings={settings} scroller={scroller} onSaved={saved} onRefresh={() => void refresh()} />
				</div>
				{tab === 'history' && <HistoryTab onRestored={saved} />}
			</main>
		</>
	);
};
