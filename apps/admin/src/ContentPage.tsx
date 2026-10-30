import { useEffect, useMemo, useState } from 'react';

import type { ContentNode, NodeType } from '@rw/core';

import { api, UnauthorizedError } from './api';
import type { ContentResponse } from './api';

const TYPE_LABELS: Record<NodeType, string> = {
	section: 'раздел',
	link: 'ссылка',
	goto: 'переход',
};

type Tree = {
	root: ContentNode | undefined;
	byId: Map<number, ContentNode>;
	children: Map<number, ContentNode[]>;
};

const buildTree = (nodes: ContentNode[]): Tree => {
	const byId = new Map(nodes.map(node => [node.id, node]));
	const children = new Map<number, ContentNode[]>();

	for (const node of nodes) {
		if (node.parentId !== null) {
			children.set(node.parentId, [...children.get(node.parentId) ?? [], node]);
		}
	}

	for (const list of children.values()) {
		list.sort((a, b) => a.sort - b.sort || a.id - b.id);
	}

	return { root: nodes.find(node => node.parentId === null), byId, children };
};

const TreeItem = ({ node, tree, selectedId, onSelect }: { node: ContentNode; tree: Tree; selectedId: number | null; onSelect: (id: number) => void; }) => {
	const children = tree.children.get(node.id) ?? [];
	const classes = ['tree-row', node.id === selectedId ? 'selected' : '', node.isActive ? '' : 'inactive'].join(' ');

	return (
		<li>
			<button className={classes} onClick={() => onSelect(node.id)}>
				<span className="tree-title">{node.title}</span>
				{node.type !== 'section' && <span className="badge">{TYPE_LABELS[node.type]}</span>}
				{node.isHidden && <span className="badge">скрыт</span>}
				{!node.isActive && <span className="badge">выключен</span>}
			</button>
			{children.length > 0 && (
				<ul>
					{children.map(child => <TreeItem key={child.id} node={child} tree={tree} selectedId={selectedId} onSelect={onSelect} />)}
				</ul>
			)}
		</li>
	);
};

const NodeDetails = ({ node, tree }: { node: ContentNode; tree: Tree; }) => {
	const target = node.targetId === null ? undefined : tree.byId.get(node.targetId);

	return (
		<div className="details">
			<h2>{node.title}</h2>
			<dl>
				<dt>Код</dt>
				<dd><code>{node.code}</code></dd>
				<dt>Тип</dt>
				<dd>{TYPE_LABELS[node.type]}</dd>
				{node.url && (
					<>
						<dt>Ссылка</dt>
						<dd><a href={node.url} target="_blank" rel="noreferrer">{node.url}</a></dd>
					</>
				)}
				{target && (
					<>
						<dt>Ведет в</dt>
						<dd>{target.title}</dd>
					</>
				)}
				{node.image && (
					<>
						<dt>Картинка</dt>
						<dd><code>media/{node.image}</code></dd>
					</>
				)}
				{node.imageText && (
					<>
						<dt>Текст картинки</dt>
						<dd style={{ whiteSpace: 'pre-line' }}>{node.imageText}</dd>
					</>
				)}
				{node.file && (
					<>
						<dt>Файл</dt>
						<dd><code>media/{node.file}</code> ({node.fileName ?? 'без имени'})</dd>
					</>
				)}
			</dl>
			{node.text && (
				<>
					<h3>Текст сообщения</h3>
					{/* Текст — HTML из БД, который бот отправляет в MAX; показываем исходник, а не рендерим его */}
					<pre className="message">{node.text}</pre>
				</>
			)}
			<h3>Синонимы ({node.synonyms.length})</h3>
			{node.synonyms.length > 0
				? <div className="chips">{node.synonyms.map(synonym => <span key={synonym} className="chip">{synonym}</span>)}</div>
				: <p className="muted">Нет: раздел находится только по названию</p>}
		</div>
	);
};

export const ContentPage = ({ onUnauthorized }: { onUnauthorized: () => void; }) => {
	const [content, setContent] = useState<ContentResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [selectedId, setSelectedId] = useState<number | null>(null);

	useEffect(() => {
		api.content()
			.then(setContent)
			.catch((loadError: unknown) => {
				if (loadError instanceof UnauthorizedError) {
					onUnauthorized();
				} else {
					setError(loadError instanceof Error ? loadError.message : String(loadError));
				}
			});
	}, [onUnauthorized]);

	const tree = useMemo(() => content && buildTree(content.nodes), [content]);
	const selected = selectedId === null ? undefined : tree?.byId.get(selectedId);

	if (error) {
		return <div className="center error">{error}</div>;
	}

	if (!tree?.root) {
		return <div className="center muted">Загрузка контента…</div>;
	}

	return (
		<main className="content">
			<nav className="tree">
				<ul>
					<TreeItem node={tree.root} tree={tree} selectedId={selectedId} onSelect={setSelectedId} />
				</ul>
			</nav>
			<section className="panel">
				{selected
					? <NodeDetails node={selected} tree={tree} />
					: <p className="muted">Выберите раздел слева. Редактирование появится на следующем шаге.</p>}
			</section>
		</main>
	);
};
