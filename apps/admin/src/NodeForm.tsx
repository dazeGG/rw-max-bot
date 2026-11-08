import { DeleteOutlined, EllipsisOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import { Alert, App, Badge, Breadcrumb, Button, Card, Divider, Dropdown, Form, Input, Modal, Progress, Segmented, Select, Switch, Tag } from 'antd';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import type { AdminContentNode, AdminUser, ContentTable, Settings, UpdateNodeRequest } from '@rw/core';

import { api, ConflictError, mediaUrl } from './api';
import { FileField, ImageField } from './attachments';
import { ancestorsOf, pathOf, previewReplies, subtreeOf } from './content-tree';
import type { Tree } from './content-tree';
import { formatDate, formatTime } from './labels';
import { MessageEditor, MessageView } from './MessageEditor';
import { shortName } from './page';
import { errorText } from './session';
import { emptyTable, renderKey, sheetOf, tablesFilled, tablesProblem } from './table-edit';
import { uploadTablesImage } from './table-render';
import { TableEditor } from './TableEditor';
import { useUnsavedGuard } from './unsaved';

// Лимит текста сообщения в API MAX. Сервер проверяет сам текст, здесь — текст вместе с вариантами
const MAX_MESSAGE_LENGTH = 4000;

type Values = {
	title: string;
	text: string;
	url: string;
	targetId: number | null;
	synonyms: string[];
	image: string | null;
	imageText: string;
	// null — обычная картинка, массив — таблицы, из которых картинку рисует браузер
	tables: ContentTable[] | null;
	file: string | null;
	fileName: string | null;
	isActive: boolean;
	isHidden: boolean;
};

const toValues = (node: AdminContentNode): Values => ({
	title: node.title,
	text: node.text ?? '',
	url: node.url ?? '',
	targetId: node.targetId,
	synonyms: node.synonyms,
	image: node.image,
	imageText: node.imageText ?? '',
	tables: node.tables,
	file: node.file,
	fileName: node.fileName,
	isActive: node.isActive,
	isHidden: node.isHidden,
});

const Preview = ({ tree, settings, node, values }: { tree: Tree; settings: Settings; node: AdminContentNode; values: Values; }) => {
	const replies = useMemo(() => previewReplies(tree, settings, {
		...node,
		title: values.title,
		text: values.text.trim() ? values.text : null,
		url: values.url || null,
		targetId: values.targetId,
		image: values.image,
		file: values.file,
		fileName: values.fileName,
		isHidden: values.isHidden,
	}), [tree, settings, node, values]);

	const main = replies[0];
	const tooLong = main !== undefined && main.text.length > MAX_MESSAGE_LENGTH;

	return (
		<aside className="preview">
			<Card size="small" title="Как увидит пассажир" extra={<Tag variant="filled">MAX</Tag>}>
				{!values.isActive && <p className="muted preview-note">Раздел выключен: пока пассажиры его не видят.</p>}
				{!main && <Alert type="warning" title="Бот не покажет этот пункт: раздел, куда он ведет, не выбран или выключен" />}
				{main && (
					<>
						<div className="max-chat">
							<div className="bubble">
								{main.image && <img src={mediaUrl(main.image)} alt="" />}
								<MessageView text={main.text} />
								{main.file && <div className="bubble-file">Файл: {main.file.name}</div>}
								<span className="bubble-time">{formatTime(node.updatedAt)}</span>
							</div>
							{replies.slice(1).map(reply => <div key={reply.text} className="bubble">{reply.text}</div>)}
						</div>
						<Progress
							percent={Math.min(100, main.text.length / MAX_MESSAGE_LENGTH * 100)}
							showInfo={false}
							size="small"
							status={tooLong ? 'exception' : 'normal'}
						/>
						<div className={tooLong ? 'error small' : 'muted small'}>
							{main.text.length} из {MAX_MESSAGE_LENGTH} символов вместе с разметкой
						</div>
						{tooLong && (
							<Alert className="preview-alert" type="error" title="MAX может не принять такое длинное сообщение. Сократите текст или вынесите часть в отдельный раздел" />
						)}
					</>
				)}
			</Card>
		</aside>
	);
};

type DeleteModalProps = {
	node: AdminContentNode;
	tree: Tree;
	settings: Settings;
	dirty: boolean;
	onDisable: () => void;
	onDeleted: () => void;
	onClose: () => void;
};

const DeleteModal = ({ node, tree, settings, dirty, onDisable, onDeleted, onClose }: DeleteModalProps) => {
	const removed = subtreeOf(tree, node.id);
	const nested = removed.size - 1;
	const handoff = [...removed].some(id => tree.byId.get(id)?.code === settings['search.handoff'].trim());

	const gotos = [...tree.byId.values()].filter(item =>
		item.type === 'goto' && item.targetId !== null && removed.has(item.targetId) && !removed.has(item.id));

	const remove = useMutation({
		mutationFn: () => api.deleteNode(node.id),
		onSuccess: onDeleted,
	});

	return (
		<Modal
			open
			title={`Удалить «${node.title}»?`}
			onCancel={onClose}
			footer={(
				<>
					<Button onClick={onClose}>Отмена</Button>
					{node.isActive && !dirty && <Button onClick={onDisable}>Выключить</Button>}
					{!handoff && <Button danger type="primary" loading={remove.isPending} onClick={() => remove.mutate()}>Удалить</Button>}
				</>
			)}
		>
			{handoff
				? <Alert type="warning" title="На этот раздел ведет пункт «Нет подходящего варианта», поэтому удалить его нельзя. Раздел можно выключить: пункт исчезнет из уточнений поиска. Куда ведет пункт, меняется в настройках." />
				: <p>Вернуть раздел можно будет только вместе со всем контентом: в настройках, в истории версий. Если он может понадобиться, лучше выключить его.</p>}
			{nested > 0 && <p>Вместе с ним будут удалены вложенные разделы: {nested}.</p>}
			{gotos.length > 0 && (
				<>
					<p>Сюда ведут переходы — бот перестанет их показывать:</p>
					<ul>
						{gotos.map(item => <li key={item.id}>{pathOf(tree, item)}</li>)}
					</ul>
				</>
			)}
			{remove.isError && <Alert type="error" title={errorText(remove.error)} />}
		</Modal>
	);
};

const SectionTitle = ({ children }: { children: string; }) => (
	<Divider className="form-section" titlePlacement="start">{children}</Divider>
);

type NodeFormProps = {
	node: AdminContentNode;
	tree: Tree;
	settings: Settings;
	user: AdminUser;
	// Правка сохранена, теперь ее должен применить бот
	onSaved: () => Promise<void>;
	onRefresh: () => void;
};

// Монтируется заново при смене раздела или его версии (key в ContentPage): значения формы всегда от нее
export const NodeForm = ({ node, tree, settings, user, onSaved, onRefresh }: NodeFormProps) => {
	const [form] = Form.useForm<Values>();
	const { message, modal: confirmModal } = App.useApp();
	const navigate = useNavigate();
	const initial = useMemo(() => toValues(node), [node]);
	const watched = Form.useWatch([], form) as Partial<Values> | undefined;
	const values: Values = { ...initial, ...watched };
	const [deleting, setDeleting] = useState(false);
	const superadmin = user.role === 'superadmin';
	const isRoot = node.parentId === null;

	const dirty = (Object.keys(initial) as (keyof Values)[]).some(key => JSON.stringify(values[key]) !== JSON.stringify(initial[key]));

	const { leave, modal } = useUnsavedGuard(dirty, 'Если уйти сейчас, изменения в этом разделе пропадут.');

	// tables — таблицы, чью картинку нужно нарисовать и загрузить до записи раздела.
	// Сбой рендера или загрузки бросает ошибку до PATCH: раздел не меняется, форма сохраняет введённое
	const save = useMutation({
		mutationFn: async ({ body, tables }: { body: UpdateNodeRequest; tables?: ContentTable[]; }) => {
			const image = tables ? await uploadTablesImage(tables.map(sheetOf)) : undefined;

			return api.updateNode(node.id, image ? { ...body, image } : body);
		},
		onSuccess: onSaved,
	});

	const tableMode = values.tables !== null;
	const problem = values.tables ? tablesProblem(values.tables) : null;
	// Админ не трогает обычную картинку: перейти на таблицу он может, только если картинки в разделе нет
	const canTable = superadmin || !node.image || node.tables !== null;

	const switchMode = (mode: string | number) => {
		if (mode === 'table') {
			form.setFieldValue('tables', [emptyTable()]);
		} else if (values.tables && tablesFilled(values.tables)) {
			confirmModal.confirm({
				title: 'Вернуться к обычной картинке?',
				content: 'Таблицы будут удалены из раздела. Картинка останется той, что нарисована по ним, и дальше её можно будет только заменить.',
				okText: 'Убрать таблицы',
				okButtonProps: { danger: true },
				cancelText: 'Остаться',
				onOk: () => form.setFieldValue('tables', null),
			});
		} else {
			form.setFieldValue('tables', null);
		}
	};

	const submit = () => {
		const current = form.getFieldsValue(true);
		const tables = current.tables;
		const tablesChanged = JSON.stringify(tables) !== JSON.stringify(initial.tables);
		// Картинка перерисовывается, только если изменилось то, что на ней видно
		const draw = tables !== null && (initial.tables === null || renderKey(tables) !== renderKey(initial.tables));

		save.mutate({
			tables: draw ? tables : undefined,
			body: {
				updatedAt: node.updatedAt,
				title: current.title,
				synonyms: current.synonyms,
				isActive: current.isActive,
				isHidden: current.isHidden,
				...node.type === 'section' ? { text: current.text, file: current.file, fileName: current.fileName } : {},
				// В режиме таблицы картинку и текст для поиска даёт сохранение таблиц
				...node.type === 'section' && superadmin && tables === null ? { image: current.image, imageText: current.imageText } : {},
				...node.type === 'section' && tablesChanged ? { tables } : {},
				...node.type === 'link' ? { url: current.url } : {},
				...node.type === 'goto' ? { targetId: current.targetId } : {},
			},
		});
	};

	const disable = () => {
		setDeleting(false);
		save.mutate({ body: { updatedAt: node.updatedAt, isActive: false } });
	};

	const deleted = async () => {
		// Раздела больше нет: спрашивать про несохраненное незачем
		leave();
		await onSaved();
		message.success('Раздел удален');
		await navigate(node.parentId === null ? '/content' : `/content/${node.parentId}`);
	};

	const excluded = subtreeOf(tree, node.id);
	const targets = [...tree.byId.values()]
		.filter(item => !excluded.has(item.id) && item.parentId !== null)
		.map(item => ({ value: item.id, label: pathOf(tree, item) }));

	return (
		<Card className="node-card">
			<Form form={form} className="node-form" layout="vertical" initialValues={initial} onFinish={submit}>
				<div className="node-head">
					<Breadcrumb
						items={[
							...ancestorsOf(tree, node.id).map(item => ({ key: item.id, title: <Link to={`/content/${item.id}`}>{item.title}</Link> })),
							{ key: node.id, title: values.title },
						]}
					/>
					<div className="node-head-row">
						<h2>{values.title || 'Без названия'}</h2>
						{!isRoot && (
							<>
								<label className="node-switch">
									<Form.Item name="isActive" valuePropName="checked" noStyle>
										<Switch />
									</Form.Item>
									{values.isActive ? 'Включён' : 'Выключен'}
								</label>
								<Dropdown
									trigger={['click']}
									menu={{ items: [{ key: 'delete', icon: <DeleteOutlined />, label: 'Удалить', danger: true, onClick: () => setDeleting(true) }] }}
								>
									<Button icon={<EllipsisOutlined />} aria-label="Ещё действия" />
								</Dropdown>
							</>
						)}
					</div>
					<div className="muted">
						Код <code>{node.code}</code>
						{node.updatedBy && ` · изменено: ${shortName(node.updatedBy)}, ${formatDate(node.updatedAt)}`}
					</div>
				</div>

				<div className="node-body">
					<div className="node-fields">
						{node.code === 'operator' && (
							<Alert className="form-alert" type="info" title="Этот пункт передает пассажира в чат поддержки. Поиск его не находит, текст раздела пассажир не увидит. Такой же пункт есть в главном меню: он работает, только если включены оба." />
						)}

						<SectionTitle>Сообщение</SectionTitle>

						<Form.Item name="title" label="Название пункта" rules={[{ required: true, whitespace: true, message: 'Введите название' }]}>
							<Input maxLength={200} />
						</Form.Item>

						{node.type === 'section' && (
							<Form.Item
								name="text"
								label="Текст сообщения"
								extra="Enter — новая строка. Если текст пустой, бот покажет название пункта. Варианты ответа бот добавит сам, их видно в предпросмотре."
							>
								<MessageEditor />
							</Form.Item>
						)}

						{node.type === 'link' && (
							<Form.Item name="url" label="Адрес сайта" rules={[{ required: true, whitespace: true, message: 'Введите адрес' }]}>
								<Input placeholder="https://" maxLength={2000} />
							</Form.Item>
						)}

						{node.type === 'goto' && (
							<Form.Item name="targetId" label="Куда ведет" rules={[{ required: true, message: 'Выберите раздел' }]}>
								<Select options={targets} showSearch={{ optionFilterProp: 'label' }} placeholder="Выберите раздел" />
							</Form.Item>
						)}

						{node.type === 'section' && (
							<>
								<SectionTitle>Вложения</SectionTitle>

								<Form.Item label="Картинка в сообщении">
									<Segmented
										value={tableMode ? 'table' : 'image'}
										onChange={switchMode}
										options={[
											{ value: 'image', label: 'Картинка', disabled: tableMode && !superadmin },
											{ value: 'table', label: 'Таблица', disabled: !canTable },
										]}
									/>
								</Form.Item>

								{tableMode && (
									<>
										<Form.Item name="tables" noStyle>
											<TableEditor problem={problem} />
										</Form.Item>
										{!superadmin && <div className="muted small table-note">Обычную картинку в этом разделе заменить нельзя: она нарисована по таблицам.</div>}
									</>
								)}

								<div className="attachments-grid">
									{!tableMode && (
										<Form.Item name="image" label="Картинка">
											<ImageField readOnly={!superadmin} />
										</Form.Item>
									)}
									<Form.Item name="file" label="Файл">
										<FileField name={values.fileName} onNameChange={fileName => form.setFieldValue('fileName', fileName)} />
									</Form.Item>
								</div>
								<Form.Item name="fileName" hidden>
									<Input />
								</Form.Item>

								{!tableMode && values.image !== initial.image && (
									<Alert className="form-alert" type="warning" title="Проверьте текст с картинки, поиск опирается на него" />
								)}

								{!tableMode && (values.image || node.imageText) && (
									<Form.Item
										name="imageText"
										label="Текст с картинки"
										extra={superadmin ? 'Пассажир его не видит, по нему работает поиск.' : 'Пассажир его не видит, по нему работает поиск. Менять может только суперадмин.'}
									>
										<Input.TextArea autoSize={{ minRows: 3, maxRows: 12 }} readOnly={!superadmin} />
									</Form.Item>
								)}
							</>
						)}

						<SectionTitle>Поиск и показ</SectionTitle>

						<Form.Item
							name="synonyms"
							label="Как об этом спрашивают"
							extra="Целые фразы, как напишет пассажир: «как вернуть деньги за билет», а не отдельные слова. Enter добавляет фразу."
						>
							<Select mode="tags" open={false} suffixIcon={null} tokenSeparators={[]} />
						</Form.Item>

						{!isRoot && (
							<label className="switch-row">
								<Form.Item name="isHidden" valuePropName="checked" noStyle>
									<Switch size="small" />
								</Form.Item>
								<span>
									<div>Скрыть из меню</div>
									<div className="muted">Пункта нет в списке вариантов, но раздел находится через поиск и переходы.</div>
								</span>
							</label>
						)}
					</div>

					<Preview tree={tree} settings={settings} node={node} values={values} />
				</div>

				{save.isError && (
					<Alert
						className="node-error"
						type="error"
						title={errorText(save.error)}
						action={save.error instanceof ConflictError ? <Button size="small" onClick={onRefresh}>Обновить</Button> : undefined}
						description={save.error instanceof ConflictError ? 'После обновления ваши несохраненные правки пропадут: скопируйте их, если они нужны.' : undefined}
					/>
				)}

				<div className="form-bar">
					<Button type="primary" htmlType="submit" disabled={!dirty || problem !== null} loading={save.isPending}>Сохранить</Button>
					{dirty && (
						<>
							<Button onClick={() => form.resetFields()}>Отменить правки</Button>
							<Badge status="warning" text="Есть несохранённые правки" />
						</>
					)}
				</div>
			</Form>

			{deleting && (
				<DeleteModal
					node={node}
					tree={tree}
					settings={settings}
					dirty={dirty}
					onDisable={disable}
					onDeleted={() => void deleted()}
					onClose={() => setDeleting(false)}
				/>
			)}

			{modal}
		</Card>
	);
};
