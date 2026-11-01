import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, App, Button, Form, Input, Modal, Radio, Select, Tag, Tree as AntTree } from 'antd';
import type { TreeDataNode, TreeProps } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import type { AdminContentNode, AdminUser, CreateNodeRequest, NodeType } from '@rw/core';

import { api } from './api';
import { ancestorsOf, buildTree, dropPlace, isSamePlace, matchingIds, pathOf } from './content-tree';
import type { Tree } from './content-tree';
import { NodeForm } from './NodeForm';
import { errorText, queryClient } from './session';

const CONTENT_KEY = ['content'];

const TYPE_OPTIONS: { value: NodeType; label: string; }[] = [
	{ value: 'section', label: 'Ответ' },
	{ value: 'link', label: 'Ссылка на сайт' },
	{ value: 'goto', label: 'Переход в другой раздел' },
];

type ApplyStatus = 'idle' | 'applying' | 'applied' | 'deferred';

const APPLY_LABELS: Record<ApplyStatus, string> = {
	idle: '',
	applying: 'Бот применяет правки…',
	applied: 'Бот применил правки',
	deferred: 'Правка сохранена. Бот применит ее в течение 5 минут',
};

// Бот перестраивает индекс поиска несколько секунд, поэтому сохранение его не ждет.
// При правках подряд статус показывает только последний сигнал: бот в итоге применит самую свежую версию
const useApply = () => {
	const [status, setStatus] = useState<ApplyStatus>('idle');
	const last = useRef(0);

	const apply = useCallback(() => {
		const id = ++last.current;

		setStatus('applying');
		api.applyContent().then(
			() => {
				if (id === last.current) {
					setStatus('applied');
				}
			},
			() => {
				if (id === last.current) {
					setStatus('deferred');
				}
			},
		);
	}, []);

	return { status, apply };
};

const NodeLabel = ({ node, off }: { node: AdminContentNode; off: boolean; }) => (
	<span className="tree-row">
		<span className={off ? 'tree-title inactive' : 'tree-title'}>{node.title}</span>
		{node.type === 'link' && <Tag>ссылка</Tag>}
		{node.type === 'goto' && (node.targetId === null ? <Tag color="error">нет цели</Tag> : <Tag>переход</Tag>)}
		{node.isHidden && <Tag>скрыт</Tag>}
		{!node.isActive && <Tag>выключен</Tag>}
	</span>
);

const toTreeData = (tree: Tree, node: AdminContentNode, visible: Set<number> | null, parentOff = false): TreeDataNode => {
	const off = parentOff || !node.isActive;

	return {
		key: node.id,
		title: <NodeLabel node={node} off={off} />,
		children: (tree.children.get(node.id) ?? [])
			.filter(child => !visible || visible.has(child.id))
			.map(child => toTreeData(tree, child, visible, off)),
	};
};

type AddNodeModalProps = {
	tree: Tree;
	parent: AdminContentNode;
	onCreated: (node: AdminContentNode) => void;
	onClose: () => void;
};

const AddNodeModal = ({ tree, parent, onCreated, onClose }: AddNodeModalProps) => {
	const [form] = Form.useForm<CreateNodeRequest>();
	const type = Form.useWatch('type', form) ?? 'section';

	const create = useMutation({
		mutationFn: (values: CreateNodeRequest) => api.createNode({ ...values, parentId: parent.id }),
		onSuccess: onCreated,
	});

	const targets = [...tree.byId.values()]
		.filter(item => item.parentId !== null)
		.map(item => ({ value: item.id, label: pathOf(tree, item) }));

	return (
		<Modal
			open
			title={`Новый пункт в «${parent.title}»`}
			okText="Добавить"
			okButtonProps={{ htmlType: 'submit', form: 'add-node', loading: create.isPending }}
			onCancel={onClose}
		>
			<Form id="add-node" form={form} layout="vertical" initialValues={{ type: 'section' }} onFinish={create.mutate}>
				<Form.Item name="type" label="Что это за пункт" extra="Тип потом не меняется.">
					<Radio.Group options={TYPE_OPTIONS} optionType="button" />
				</Form.Item>
				<Form.Item name="title" label="Название" rules={[{ required: true, whitespace: true, message: 'Введите название' }]}>
					<Input autoFocus maxLength={200} />
				</Form.Item>
				{type === 'link' && (
					<Form.Item name="url" label="Адрес сайта" rules={[{ required: true, whitespace: true, message: 'Введите адрес' }]}>
						<Input placeholder="https://" maxLength={2000} />
					</Form.Item>
				)}
				{type === 'goto' && (
					<Form.Item name="targetId" label="Куда ведет" rules={[{ required: true, message: 'Выберите раздел' }]}>
						<Select options={targets} showSearch={{ optionFilterProp: 'label' }} placeholder="Выберите раздел" />
					</Form.Item>
				)}
				<p className="muted">Пункт появится выключенным: заполните его и включите, когда он будет готов.</p>
				{create.isError && <Alert type="error" title={errorText(create.error)} />}
			</Form>
		</Modal>
	);
};

export const ContentPage = ({ user }: { user: AdminUser; }) => {
	const params = useParams();
	const navigate = useNavigate();
	const { message } = App.useApp();
	const { status, apply } = useApply();
	const [query, setQuery] = useState('');
	const [expanded, setExpanded] = useState<React.Key[]>([]);
	const [adding, setAdding] = useState(false);

	// На фокус не перечитываем: дерево под правками сотрудника не должно меняться само
	const content = useQuery({
		queryKey: CONTENT_KEY,
		queryFn: api.content,
		refetchOnWindowFocus: false,
	});

	const tree = useMemo(() => content.data && buildTree(content.data.nodes), [content.data]);
	const selectedId = Number(params.nodeId);
	const selected = tree?.byId.get(selectedId);
	const rootId = tree?.root?.id;

	const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey: CONTENT_KEY }), []);

	const saved = useCallback(async () => {
		await refresh();
		apply();
	}, [refresh, apply]);

	const move = useMutation({
		mutationFn: ({ id, parentId, index }: { id: number; parentId: number; index: number; }) => api.moveNode(id, { parentId, index }),
		onSuccess: saved,
		onError: error => void message.error(errorText(error)),
	});

	// Раздел из ссылки должен быть виден, а открытое вручную — оставаться открытым
	useEffect(() => {
		if (tree && rootId !== undefined) {
			const needed = [rootId, ...selected ? ancestorsOf(tree, selected.id).map(node => node.id) : []];
			setExpanded(current => [...new Set([...current, ...needed])]);
		}
	}, [tree, rootId, selected]);

	const visible = useMemo(() => tree && query.trim() ? matchingIds(tree, query) : null, [tree, query]);
	const treeData = useMemo(() => tree?.root ? [toTreeData(tree, tree.root, visible)] : [], [tree, visible]);

	if (content.isError) {
		return <div className="center error">{errorText(content.error)}</div>;
	}

	if (!tree?.root || !content.data) {
		return <div className="center muted">Загрузка контента…</div>;
	}

	const onDrop: TreeProps['onDrop'] = info => {
		const id = Number(info.dragNode.key);
		const side = info.dropPosition - Number(info.node.pos.split('-').at(-1));
		const place = dropPlace(tree, id, Number(info.node.key), info.dropToGap, side);

		if (!isSamePlace(tree, id, place)) {
			move.mutate({ id, ...place });
		}
	};

	const allowDrop: TreeProps['allowDrop'] = ({ dropNode, dropPosition }) => {
		const target = tree.byId.get(Number(dropNode.key));
		return dropPosition === 0 ? target?.type === 'section' : target?.parentId !== null;
	};

	const addParent = selected?.type === 'section' ? selected : tree.byId.get(selected?.parentId ?? tree.root.id) ?? tree.root;

	return (
		<main className="content">
			<nav className="tree">
				<div className="tree-toolbar">
					<Input.Search allowClear placeholder="Поиск по названию и фразам" value={query} onChange={event => setQuery(event.target.value)} />
					<Button type="primary" onClick={() => setAdding(true)}>Добавить</Button>
				</div>
				{status !== 'idle' && <div className={status === 'deferred' ? 'apply-status warn' : 'apply-status'} role="status">{APPLY_LABELS[status]}</div>}
				{visible?.size === 0 && <p className="muted">Ничего не найдено</p>}
				<AntTree
					blockNode
					treeData={treeData}
					selectedKeys={selected ? [selected.id] : []}
					expandedKeys={visible ? [...visible] : expanded}
					draggable={visible
						? false
						: {
							icon: false,
							nodeDraggable: node => node.key !== rootId,
						}}
					allowDrop={allowDrop}
					onDrop={onDrop}
					onExpand={keys => {
						if (!visible) {
							setExpanded(keys);
						}
					}}
					onSelect={(_, { node }) => void navigate(`/content/${node.key}`)}
				/>
			</nav>
			<section className="panel">
				{selected
					? (
						<NodeForm
							key={`${selected.id}:${selected.updatedAt}`}
							node={selected}
							tree={tree}
							settings={content.data.settings}
							user={user}
							onSaved={saved}
							onRefresh={() => void refresh()}
						/>
					)
					: <p className="muted">Выберите раздел слева.</p>}
			</section>
			{adding && (
				<AddNodeModal
					tree={tree}
					parent={addParent}
					onClose={() => setAdding(false)}
					onCreated={node => {
						setAdding(false);
						// Новый пункт выключен: для пассажиров ничего не изменилось, бота не беспокоим
						void refresh().then(() => navigate(`/content/${node.id}`));
					}}
				/>
			)}
		</main>
	);
};
