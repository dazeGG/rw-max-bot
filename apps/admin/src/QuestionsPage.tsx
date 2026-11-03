// Вопросы пассажиров и проверка поиска: главная регулярная работа админа

import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, App, Button, Form, Input, Modal, Segmented, Select, Table, Tabs, Tag } from 'antd';
import type { TableColumnsType } from 'antd';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import type { AdminContentNode, PassengerQuestion, QuestionSource, SearchCheckNode, SearchCheckResult } from '@rw/core';

import { api } from './api';
import { ApplyStatus, useApply } from './apply-status';
import { buildTree, pathOf } from './content-tree';
import type { Tree } from './content-tree';
import { formatDate } from './labels';
import { CONTENT_KEY, errorText, queryClient } from './session';

const QUESTIONS_KEY = ['questions'];

const PHRASE_LIMIT = 300;
const TITLE_LIMIT = 200;
const CHECK_LIMIT = 1000;

const PHRASE_HINT = 'Пишите целую фразу, как спрашивают люди. Отдельные названия станций уводят вопросы не туда.';

const SOURCE_LABELS: Record<QuestionSource, string> = {
	unrecognized: 'Бот не понял',
	noOption: 'Нет подходящего варианта',
};

const refresh = () => Promise.all([
	queryClient.invalidateQueries({ queryKey: QUESTIONS_KEY }),
	queryClient.invalidateQueries({ queryKey: CONTENT_KEY }),
]);

// Поиск идет по ответам и ссылкам с текстом, у остальных пунктов фраза ни на что не повлияет
const searchable = (node: AdminContentNode) => node.parentId !== null && (node.type === 'section' || (node.type === 'link' && Boolean(node.text?.trim())));

const nodeOptions = (tree: Tree, filter: (node: AdminContentNode) => boolean) => [...tree.byId.values()]
	.filter(filter)
	.map(node => ({ value: node.id, label: pathOf(tree, node) || node.title }));

type ModalProps = {
	question: PassengerQuestion;
	tree: Tree;
	onClose: () => void;
};

const addPhrase = async (node: AdminContentNode, phrase: string, key: string) => {
	await api.updateNode(node.id, { updatedAt: node.updatedAt, synonyms: [...node.synonyms, phrase.trim()] });
	await api.reviewQuestion({ key, status: 'resolved' });
};

const AddToSectionModal = ({ question, tree, onClose, onAdded }: ModalProps & { onAdded: (title: string) => void; }) => {
	const [form] = Form.useForm<{ phrase: string; nodeId: number; }>();
	const selected = Form.useWatch('nodeId', form);

	const add = useMutation({
		mutationFn: async ({ phrase, nodeId }: { phrase: string; nodeId: number; }) => {
			const node = tree.byId.get(nodeId)!;
			await addPhrase(node, phrase, question.key);
			return node.title;
		},
		onSuccess: title => {
			onAdded(title);
			onClose();
		},
		// Раздел мог изменить другой сотрудник: со свежими данными можно сразу повторить
		onError: () => void queryClient.invalidateQueries({ queryKey: CONTENT_KEY }),
		onSettled: refresh,
	});

	return (
		<Modal
			open
			title="Добавить к разделу"
			okText="Добавить"
			okButtonProps={{ htmlType: 'submit', form: 'add-phrase', loading: add.isPending }}
			onCancel={onClose}
		>
			<Form id="add-phrase" form={form} layout="vertical" initialValues={{ phrase: question.phrase.slice(0, PHRASE_LIMIT) }} onFinish={add.mutate}>
				<Form.Item name="phrase" label="Как об этом спрашивают" extra={PHRASE_HINT} rules={[{ required: true, whitespace: true, message: 'Введите фразу' }]}>
					<Input maxLength={PHRASE_LIMIT} />
				</Form.Item>
				{question.suggestions.length > 0 && (
					<div className="question-suggestions">
						<div className="muted">Подходящие разделы</div>
						{question.suggestions.map(node => (
							<Button key={node.id} size="small" type={selected === node.id ? 'primary' : 'default'} onClick={() => form.setFieldValue('nodeId', node.id)}>
								{node.title}
							</Button>
						))}
					</div>
				)}
				<Form.Item name="nodeId" label="Раздел" rules={[{ required: true, message: 'Выберите раздел' }]}>
					<Select options={nodeOptions(tree, searchable)} showSearch={{ optionFilterProp: 'label' }} placeholder="Выберите раздел" />
				</Form.Item>
				{add.isError && <Alert type="error" title={errorText(add.error)} />}
			</Form>
		</Modal>
	);
};

const CreateSectionModal = ({ question, tree, onClose }: ModalProps) => {
	const [form] = Form.useForm<{ title: string; parentId: number; }>();
	const navigate = useNavigate();

	const create = useMutation({
		mutationFn: async ({ title, parentId }: { title: string; parentId: number; }) => {
			const node = await api.createNode({ parentId, type: 'section', title });
			await addPhrase(node, question.phrase.slice(0, PHRASE_LIMIT), question.key);
			return node;
		},
		onSuccess: async node => {
			await refresh();
			await navigate(`/content/${node.id}`);
		},
	});

	return (
		<Modal
			open
			title="Создать раздел"
			okText="Создать"
			okButtonProps={{ htmlType: 'submit', form: 'create-section', loading: create.isPending }}
			onCancel={onClose}
		>
			<Form
				id="create-section"
				form={form}
				layout="vertical"
				initialValues={{ title: question.phrase.slice(0, TITLE_LIMIT), parentId: tree.root?.id }}
				onFinish={create.mutate}
			>
				<Form.Item name="title" label="Название" rules={[{ required: true, whitespace: true, message: 'Введите название' }]}>
					<Input maxLength={TITLE_LIMIT} />
				</Form.Item>
				<Form.Item name="parentId" label="Где находится" rules={[{ required: true, message: 'Выберите раздел' }]}>
					<Select options={nodeOptions(tree, node => node.type === 'section')} showSearch={{ optionFilterProp: 'label' }} />
				</Form.Item>
				<p className="muted">Вопрос станет поисковой фразой раздела. Раздел появится выключенным: заполните его и включите.</p>
				{create.isError && <Alert type="error" title={errorText(create.error)} />}
			</Form>
		</Modal>
	);
};

type Filter = 'all' | QuestionSource;

const QuestionsTab = ({ tree, onApply }: { tree: Tree | undefined; onApply: () => void; }) => {
	const { message } = App.useApp();
	const [filter, setFilter] = useState<Filter>('all');
	const [adding, setAdding] = useState<PassengerQuestion | null>(null);
	const [creating, setCreating] = useState<PassengerQuestion | null>(null);
	const [dismissed, setDismissed] = useState<PassengerQuestion | null>(null);

	const questions = useQuery({ queryKey: QUESTIONS_KEY, queryFn: api.questions });

	const dismiss = useMutation({
		mutationFn: (question: PassengerQuestion) => api.reviewQuestion({ key: question.key, status: 'dismissed' }),
		onSuccess: (_, question) => {
			setDismissed(question);
			return queryClient.invalidateQueries({ queryKey: QUESTIONS_KEY });
		},
		onError: error => void message.error(errorText(error)),
	});

	const undo = useMutation({
		mutationFn: (question: PassengerQuestion) => api.undoQuestionReview(question.key),
		onSuccess: () => {
			setDismissed(null);
			return queryClient.invalidateQueries({ queryKey: QUESTIONS_KEY });
		},
		onError: error => void message.error(errorText(error)),
	});

	const list = questions.data ?? [];
	const shown = filter === 'all' ? list : list.filter(question => question.sources[filter] > 0);

	const columns: TableColumnsType<PassengerQuestion> = [
		{
			title: 'Вопрос',
			key: 'text',
			render: (_, question) => (
				<>
					<div className="question-text">{question.text}</div>
					{question.offered.length > 0 && <div className="muted">Бот предлагал: {question.offered.join(', ')}</div>}
				</>
			),
		},
		{
			title: 'Откуда',
			key: 'source',
			width: 220,
			render: (_, question) => (Object.keys(SOURCE_LABELS) as QuestionSource[])
				.filter(source => question.sources[source] > 0)
				.map(source => <Tag key={source} color={source === 'noOption' ? 'gold' : undefined}>{SOURCE_LABELS[source]}</Tag>),
		},
		{
			title: 'Сколько раз',
			key: 'count',
			width: 120,
			render: (_, question) => <>{question.count} <span className="muted">({question.people} чел.)</span></>,
		},
		{ title: 'Последний', key: 'lastAt', width: 150, render: (_, question) => formatDate(question.lastAt) },
		{
			title: 'Что сделать',
			key: 'action',
			width: 340,
			render: (_, question) => (
				<div className="row-actions">
					<Button size="small" disabled={!tree} onClick={() => setAdding(question)}>К разделу</Button>
					<Button size="small" disabled={!tree} onClick={() => setCreating(question)}>Создать раздел</Button>
					<Button size="small" loading={dismiss.isPending && dismiss.variables.key === question.key} onClick={() => dismiss.mutate(question)}>Не вопрос</Button>
				</div>
			),
		},
	];

	if (questions.isError) {
		return <Alert type="error" title={errorText(questions.error)} />;
	}

	return (
		<>
			<div className="questions-bar">
				<Segmented<Filter>
					value={filter}
					onChange={setFilter}
					options={[
						{ value: 'all', label: `Все: ${list.length}` },
						...(Object.keys(SOURCE_LABELS) as QuestionSource[]).map(source => ({
							value: source,
							label: `${SOURCE_LABELS[source]}: ${list.filter(question => question.sources[source] > 0).length}`,
						})),
					]}
				/>
				<span className="muted">За последние 30 дней. Одинаковые вопросы объединены, частые сверху.</span>
			</div>

			{dismissed && (
				<Alert
					className="form-alert"
					type="info"
					title={`«${dismissed.text.slice(0, 80)}» убран из списка`}
					action={<Button size="small" loading={undo.isPending} onClick={() => undo.mutate(dismissed)}>Вернуть</Button>}
					closable={{ onClose: () => setDismissed(null) }}
				/>
			)}

			<Table
				rowKey="key"
				size="small"
				columns={columns}
				dataSource={shown}
				loading={questions.isPending}
				pagination={{ pageSize: 20, hideOnSinglePage: true, showSizeChanger: false }}
				locale={{ emptyText: 'Новых вопросов нет' }}
			/>

			{adding && tree && (
				<AddToSectionModal
					question={adding}
					tree={tree}
					onClose={() => setAdding(null)}
					onAdded={title => {
						void message.success(`Фраза добавлена к разделу «${title}»`);
						onApply();
					}}
				/>
			)}
			{creating && tree && <CreateSectionModal question={creating} tree={tree} onClose={() => setCreating(null)} />}
		</>
	);
};

const NodeLink = ({ node }: { node: SearchCheckNode; }) => <Link to={`/content/${node.id}`}>{node.title}</Link>;

const CheckResult = ({ result }: { result: SearchCheckResult; }) => {
	switch (result.kind) {
	case 'answer':
		return <Alert type="success" title={<>Ответит сразу: <NodeLink node={result.node} /></>} />;

	case 'clarify':
		return (
			<Alert
				type="warning"
				title="Уточнит:"
				description={(
					<ol className="check-options">
						{result.options.map(node => <li key={node.id}><NodeLink node={node} /></li>)}
						{result.handoff && <li className="muted">{result.handoff}</li>}
					</ol>
				)}
			/>
		);

	case 'none':
		return <Alert type="error" title="Не поймет: предложит темы главного меню" />;

	case 'service':
		return <Alert type="info" title="Это не вопрос: бот воспримет фразу как приветствие или команду меню" />;
	}
};

const CheckTab = () => {
	const [text, setText] = useState('');
	const check = useMutation({ mutationFn: api.checkSearch });

	return (
		<div className="check-tab">
			<Input.Search
				value={text}
				onChange={event => setText(event.target.value)}
				onSearch={value => {
					if (value.trim()) {
						check.mutate(value);
					}
				}}
				placeholder="Например: как вернуть билет, если поезд отменили"
				enterButton="Проверить"
				maxLength={CHECK_LIMIT}
				loading={check.isPending}
				autoFocus
			/>
			<p className="muted">{PHRASE_HINT} Проверка показывает ответ на вопрос, заданный из главного меню.</p>
			{check.isSuccess && !check.isPending && (
				<>
					<p className="muted">Фраза: «{check.variables}»</p>
					<CheckResult result={check.data} />
				</>
			)}
			{check.isError && <Alert type="error" title={errorText(check.error)} />}
		</div>
	);
};

export const QuestionsPage = () => {
	const { status, apply } = useApply();
	const content = useQuery({ queryKey: CONTENT_KEY, queryFn: api.content, refetchOnWindowFocus: false });
	const tree = useMemo(() => content.data && buildTree(content.data.nodes), [content.data]);

	return (
		<main className="page">
			<ApplyStatus status={status} />
			<Tabs
				items={[
					{ key: 'questions', label: 'Вопросы', children: <QuestionsTab tree={tree} onApply={apply} /> },
					{ key: 'check', label: 'Проверка поиска', children: <CheckTab /> },
				]}
			/>
		</main>
	);
};
