import { useMutation } from '@tanstack/react-query';
import { Alert, App, Button, Checkbox, Form, Input, Modal, Select } from 'antd';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import type { AdminContentNode, AdminUser, Settings, UpdateNodeRequest } from '@rw/core';

import { api, ConflictError, mediaUrl } from './api';
import { FileField, ImageField } from './attachments';
import { pathOf, previewReplies, subtreeOf } from './content-tree';
import type { Tree } from './content-tree';
import { MessageEditor, MessageView } from './MessageEditor';
import { errorText } from './session';
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

	return (
		<aside className="preview">
			<h3>Как увидит пассажир</h3>
			{!values.isActive && <p className="muted">Раздел выключен: пока пассажиры его не видят.</p>}
			{!main && <Alert type="warning" title="Бот не покажет этот пункт: раздел, куда он ведет, не выбран или выключен" />}
			{main && (
				<>
					<div className="bubble">
						{main.image && <img className="attachment-image" src={mediaUrl(main.image)} alt="" />}
						<MessageView text={main.text} />
						{main.file && <div className="attachment">Файл: {main.file.name}</div>}
					</div>
					{replies.slice(1).map(reply => <div key={reply.text} className="bubble">{reply.text}</div>)}
					<p className={main.text.length > MAX_MESSAGE_LENGTH ? 'error' : 'muted'}>
						{main.text.length} из {MAX_MESSAGE_LENGTH} символов вместе с разметкой
					</p>
					{main.text.length > MAX_MESSAGE_LENGTH && (
						<Alert type="error" title="MAX может не принять такое длинное сообщение. Сократите текст или вынесите часть в отдельный раздел" />
					)}
				</>
			)}
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
	const { message } = App.useApp();
	const navigate = useNavigate();
	const initial = useMemo(() => toValues(node), [node]);
	const watched = Form.useWatch([], form) as Partial<Values> | undefined;
	const values: Values = { ...initial, ...watched };
	const [deleting, setDeleting] = useState(false);
	const superadmin = user.role === 'superadmin';
	const isRoot = node.parentId === null;

	const dirty = (Object.keys(initial) as (keyof Values)[]).some(key => JSON.stringify(values[key]) !== JSON.stringify(initial[key]));

	const { leave, modal } = useUnsavedGuard(dirty, 'Если уйти сейчас, изменения в этом разделе пропадут.');

	const save = useMutation({
		mutationFn: (body: UpdateNodeRequest) => api.updateNode(node.id, body),
		onSuccess: onSaved,
	});

	const submit = () => {
		const current = form.getFieldsValue(true);

		save.mutate({
			updatedAt: node.updatedAt,
			title: current.title,
			synonyms: current.synonyms,
			isActive: current.isActive,
			isHidden: current.isHidden,
			...node.type === 'section' ? { text: current.text, file: current.file, fileName: current.fileName } : {},
			...node.type === 'section' && superadmin ? { image: current.image, imageText: current.imageText } : {},
			...node.type === 'link' ? { url: current.url } : {},
			...node.type === 'goto' ? { targetId: current.targetId } : {},
		});
	};

	const disable = () => {
		setDeleting(false);
		save.mutate({ updatedAt: node.updatedAt, isActive: false });
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
		<div className="node-editor">
			<Form form={form} className="node-form" layout="vertical" initialValues={initial} onFinish={submit}>
				<p className="muted">
					Код: <code>{node.code}</code>
					{node.updatedBy && ` · изменил(а) ${node.updatedBy}, ${new Date(node.updatedAt).toLocaleString('ru-RU')}`}
				</p>

				<Form.Item name="title" label="Название пункта" rules={[{ required: true, whitespace: true, message: 'Введите название' }]}>
					<Input maxLength={200} />
				</Form.Item>

				{node.type === 'section' && (
					<Form.Item
						name="text"
						label="Текст сообщения"
						extra="Enter начинает новую строку. Если текст пустой, бот покажет название пункта. Варианты ответа бот добавит сам — см. предпросмотр."
					>
						<MessageEditor />
					</Form.Item>
				)}

				{node.type === 'section' && (
					<>
						<Form.Item
							name="image"
							label="Картинка"
							extra={superadmin ? 'JPG, PNG или GIF до 10 МБ. Приходит вместе с текстом сообщения.' : 'Менять может только суперадмин.'}
						>
							<ImageField readOnly={!superadmin} />
						</Form.Item>

						{values.image !== initial.image && (
							<Alert className="form-alert" type="warning" title="Проверьте текст с картинки, поиск опирается на него" />
						)}

						<Form.Item name="file" label="Файл" extra="PDF, документы, таблицы или архив до 50 МБ. Приходит отдельным сообщением после текста.">
							<FileField name={values.fileName} onNameChange={fileName => form.setFieldValue('fileName', fileName)} />
						</Form.Item>
						<Form.Item name="fileName" hidden>
							<Input />
						</Form.Item>
					</>
				)}

				{node.type === 'section' && (values.image || node.imageText) && (
					<Form.Item
						name="imageText"
						label="Текст с картинки"
						extra={superadmin ? 'Пассажир его не видит, по нему работает поиск.' : 'Пассажир его не видит, по нему работает поиск. Менять может только суперадмин.'}
					>
						<Input.TextArea autoSize={{ minRows: 3, maxRows: 12 }} readOnly={!superadmin} />
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

				<Form.Item
					name="synonyms"
					label="Как об этом спрашивают"
					extra="Целые фразы, как их напишет пассажир: «как вернуть деньги за билет», а не отдельные слова. Enter добавляет фразу."
				>
					<Select mode="tags" open={false} suffixIcon={null} tokenSeparators={[]} />
				</Form.Item>

				{!isRoot && (
					<>
						<Form.Item name="isActive" valuePropName="checked" extra="Выключенный раздел со всеми вложенными бот не показывает и не ищет." className="compact-item">
							<Checkbox>Включен</Checkbox>
						</Form.Item>
						<Form.Item name="isHidden" valuePropName="checked" extra="Пункта нет в списке вариантов, но раздел находится через поиск и переходы." className="compact-item">
							<Checkbox>Скрыть из меню</Checkbox>
						</Form.Item>
					</>
				)}

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
					<span className="form-bar-spacer" />
					{!isRoot && <Button danger onClick={() => setDeleting(true)}>Удалить</Button>}
				</div>
			</Form>

			<Preview tree={tree} settings={settings} node={node} values={values} />

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
		</div>
	);
};
