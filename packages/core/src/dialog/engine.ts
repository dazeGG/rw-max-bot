import type { ContentTree } from '../content/tree';
import type { ContentNode } from '../content/types';

import { DEFAULT_SEARCH_POLICY } from './search';
import type { Candidate, DialogSearch, SearchPolicy } from './search';
import { escapeHtml, normalize, stripGreetingRaw } from './text';
import type { DialogEventDetails, DialogEvents, DialogEventType, DialogInput, DialogResult, DialogUser, Reply, Session, SessionStore } from './types';

const MAX_SUGGESTIONS = 3;
// Сколько лучших кандидатов поиска попадает в статистику
const MAX_TRACED_CANDIDATES = 5;

const BACK_WORDS = new Set(['назад', 'вернуться', 'вернуться назад', 'обратно']);
const HOME_WORDS = new Set(['меню', 'главное меню', 'в начало', 'начало', 'старт', 'start', 'в меню', 'вернуться в меню']);
// Ответы на «Могу ли я ещё Вам чем-то помочь?» после конечного ответа
const YES_WORDS = new Set([
	'да', 'ага', 'конечно', 'да конечно', 'можете', 'да можете', 'есть', 'да есть', 'есть вопрос', 'да есть вопрос',
	'есть еще вопрос', 'еще вопрос', 'у меня есть вопрос', 'у меня еще вопрос', 'помогите', 'да помогите',
]);
const NO_WORDS = new Set([
	'нет', 'нет спасибо', 'спасибо нет', 'спасибо', 'спасибо большое', 'большое спасибо', 'благодарю', 'нет благодарю',
	'не надо', 'не нужно', 'ничего', 'больше ничего', 'нет ничего', 'все', 'все спасибо', 'спасибо все', 'это все',
	'понятно', 'понятно спасибо', 'спасибо понятно', 'все понятно', 'все понятно спасибо', 'спасибо все понятно',
]);

type Choice =
	| { kind: 'node'; node: ContentNode; }
	| { kind: 'ambiguous'; candidates: ContentNode[]; }
	| { kind: 'none'; };

export class DialogEngine {
	constructor (
		private readonly getTree: () => ContentTree,
		private readonly sessions: SessionStore,
		private readonly search: DialogSearch,
		private readonly events: DialogEvents = {},
		private readonly policy: SearchPolicy = DEFAULT_SEARCH_POLICY,
	) {}

	async handle (user: DialogUser, input: DialogInput): Promise<Reply[]> {
		return (await this.process(user, input)).replies;
	}

	// Ответ вместе с записью для статистики: как бот понял сообщение
	async process (user: DialogUser, input: DialogInput): Promise<DialogResult> {
		const tree = this.getTree();

		if (input.type === 'start') {
			return this.result('start', tree.root, null, await this.open(user, tree, tree.root));
		}

		const session = await this.sessions.get(user.id);
		const current = tree.get(session.nodeId) ?? tree.root;

		return this.handleText(user, tree, current, session, input.text);
	}

	private async handleText (user: DialogUser, tree: ContentTree, current: ContentNode, session: Session, text: string): Promise<DialogResult> {
		const { greeting, rest: query } = stripGreetingRaw(text);
		const rest = normalize(query);
		const greetingReplies: Reply[] = greeting ? [{ text: tree.settings['text.greeting'] }] : [];
		const shown = this.shownOptions(tree, session);
		const details: DialogEventDetails = {
			fromNodeId: current.id,
			fromNodeCode: current.code,
			shown: shown.map(node => node.code),
			normalized: rest,
			greeting,
		};
		const done = (type: DialogEventType, node: ContentNode, replies: Reply[], extra: DialogEventDetails = {}) =>
			this.result(type, node, text, replies, { ...details, ...extra });

		// Чистое приветствие: стартовое сообщение и так начинается с приветствия
		if (query.trim() === '' || rest === 'start') {
			return done('start', tree.root, await this.open(user, tree, tree.root));
		}

		if (BACK_WORDS.has(rest)) {
			const target = tree.parent(current) ?? tree.root;
			return done('back', target, await this.open(user, tree, target));
		}

		if (HOME_WORDS.has(rest)) {
			return done('menu', tree.root, await this.open(user, tree, tree.root));
		}

		// После конечного ответа бот спросил «Могу ли я ещё Вам чем-то помочь?»: «да» — список тем, «нет» — прощание.
		// Новый вопрос вместо «да» обрабатывается как обычно
		if (this.isFinal(tree, current) && shown.every(node => tree.resolve(node).type === 'link')) {
			if (YES_WORDS.has(rest)) {
				await this.sessions.set(user.id, { nodeId: tree.root.id, choices: tree.visibleChildren(tree.root).map(node => node.id) });
				return done('more', tree.root, [{ text: this.withOptions(tree, tree.settings['text.askMore'], tree.visibleChildren(tree.root)) }]);
			}

			if (NO_WORDS.has(rest)) {
				await this.sessions.set(user.id, { nodeId: tree.root.id, choices: [] });
				return done('goodbye', tree.root, [{ text: tree.settings['text.goodbye'] }]);
			}
		}

		// Номер варианта из последнего списка: «2» — второй пункт. Номер, которого в списке нет, по тексту не ищется:
		// иначе «5» совпало бы с синонимом «ребенок до 5 лет». Номера поездов (317) — трехзначные, их ищем как текст
		const number = /^\d{1,2}[.)]?$/.test(query.trim()) ? Number(query.trim().replace(/[.)]$/, '')) : null;

		if (number !== null) {
			// Resolve the original slot before filtering deleted/disabled options.
			const option = tree.get(session.choices?.[number - 1]);

			if (option) {
				return done('option', tree.resolve(option), await this.open(user, tree, option), { option: number });
			}

			details.unmatchedOption = number;
		}

		// Слова с показанной кнопки: «Ждя» — «Тарифы в вагонах ЖДЯ», «318» — «Поезд №317/№318». Это выбор, как номер:
		// каждое слово реплики должно быть в названии варианта, поэтому новый вопрос сюда не попадает.
		// Главное меню — список тем, а не заданный вопрос: там текст ищется глобально
		const labelled = number === null && !this.isRootMenu(tree, current, shown) ? this.optionsByWords(shown, rest) : [];

		if (labelled.length === 1) {
			return done('option', tree.resolve(labelled[0]), [...greetingReplies, ...await this.open(user, tree, labelled[0])], { labelMatch: true });
		}

		if (labelled.length > 1 && labelled.length <= MAX_SUGGESTIONS) {
			await this.sessions.set(user.id, { nodeId: current.id, choices: labelled.map(node => node.id) });
			return done('clarify', current, [...greetingReplies, { text: this.withOptions(tree, tree.settings['text.didYouMean'], labelled, true) }], {
				labelMatch: true,
				suggested: labelled.map(node => node.code),
			});
		}

		const { choice, ranked }: { choice: Choice; ranked: Candidate[]; } = number === null
			? await this.choose(tree, session, query)
			: { choice: { kind: 'none' }, ranked: [] };
		const candidates = ranked.slice(0, MAX_TRACED_CANDIDATES)
			.map(candidate => ({ code: candidate.node.code, score: Math.round(candidate.score * 1000) / 1000 }));

		switch (choice.kind) {
		case 'node':
			return done('answer', tree.resolve(choice.node), [...greetingReplies, ...await this.open(user, tree, choice.node)], { candidates });

		case 'ambiguous':
			await this.sessions.set(user.id, { nodeId: current.id, choices: choice.candidates.map(node => node.id) });
			return done('clarify', current, [...greetingReplies, { text: this.withOptions(tree, tree.settings['text.didYouMean'], choice.candidates, true) }], {
				candidates,
				suggested: choice.candidates.map(node => node.code),
			});

		case 'none':
			await this.events.onUnrecognized?.({ userId: user.id, text, nodeId: current.id });
			await this.sessions.set(user.id, { nodeId: tree.root.id, choices: tree.visibleChildren(tree.root).map(node => node.id) });
			return done('unrecognized', current, [{ text: this.withOptions(tree, tree.settings['text.fallback'], tree.visibleChildren(tree.root)) }], { candidates });
		}
	}

	private result (type: DialogEventType, node: ContentNode, text: string | null, replies: Reply[], details: DialogEventDetails = {}): DialogResult {
		return { replies, event: { type, nodeId: node.id, nodeCode: node.code, text, details } };
	}

	// Navigation position is not search context. Only explicitly displayed options can be selected.
	private async choose (tree: ContentTree, session: Session, text: string): Promise<{ choice: Choice; ranked: Candidate[]; }> {
		const knowledge = tree.all().filter(node => node.id !== tree.root.id &&
			(node.type === 'section' || (node.type === 'link' && Boolean(node.text?.trim()))));
		const run = async (nodes: ContentNode[], mode?: 'options') => {
			const allowed = new Set(nodes.map(node => node.id));
			return (await this.search.rank(tree, nodes, text, mode))
				.filter(candidate => allowed.has(candidate.node.id) && Number.isFinite(candidate.score))
				.sort((a, b) => b.score - a.score || tree.depth(a.node) - tree.depth(b.node));
		};
		const ranked = await run(knowledge);
		const global = this.pick(tree, ranked);
		const offered = (session.choices ?? []).map(id => tree.get(id)).filter(node => node !== undefined);
		const current = tree.get(session.nodeId);
		// The start-page directory is not an unanswered semantic question.
		// A completed answer never borrows its parent or siblings as context.
		if (offered.length === 0 || this.isRootMenu(tree, current, offered) ||
			(global.kind === 'node' && tree.resolve(global.node).id !== current?.id)) {
			return { choice: global, ranked };
		}
		const optionRanked = await run(offered, 'options');
		const local = this.pick(tree, optionRanked, {
			threshold: this.policy.optionThreshold ?? DEFAULT_SEARCH_POLICY.optionThreshold!,
			ambiguityGap: this.policy.optionGap ?? DEFAULT_SEARCH_POLICY.optionGap!,
		}, false);
		if (global.kind === 'none') {
			return { choice: local, ranked: local.kind === 'none' ? ranked : optionRanked };
		}
		// Label/document scores are separate evidence, not interchangeable probabilities.
		// Local evidence may resolve a globally plausible option, never pull in an unrelated old topic.
		if (local.kind === 'node') {
			const close = ranked.filter(candidate => ranked[0].score - candidate.score < this.policy.ambiguityGap);
			if (close.some(candidate => tree.resolve(candidate.node).id === tree.resolve(local.node).id)) {
				return { choice: local, ranked: optionRanked };
			}
		}
		return { choice: global, ranked };
	}

	private pick (tree: ContentTree, ranked: Candidate[], policy: SearchPolicy = this.policy, collapseMenus = true): Choice {
		const seen = new Set<number>();
		const unique = ranked.filter(candidate => {
			const id = tree.resolve(candidate.node).id;
			if (seen.has(id)) {
				return false;
			}
			seen.add(id);
			return true;
		});
		const best = unique[0];
		if (!best || best.score < policy.threshold) {
			return { kind: 'none' };
		}
		// A close runner-up below threshold is still evidence against a confident answer.
		let close = unique.filter(candidate => best.score - candidate.score < policy.ambiguityGap);
		if (collapseMenus) {
			const directTargets = (node: ContentNode) => new Set(tree.visibleChildren(node)
				.map(child => tree.resolve(child).id).filter(id => id !== node.id));
			const isAncestor = (ancestor: ContentNode, descendant: ContentNode) => {
				for (let parent = tree.parent(descendant); parent; parent = tree.parent(parent)) {
					if (parent.id === ancestor.id) {
						return true;
					}
				}
				return directTargets(ancestor).has(descendant.id);
			};
			const related = (a: ContentNode, b: ContentNode) => isAncestor(a, b) || isAncestor(b, a);
			const questions = close.filter(candidate => {
				const children = directTargets(tree.resolve(candidate.node));
				return close.filter(other => children.has(tree.resolve(other.node).id)).length >= 2;
			}).sort((a, b) => tree.depth(tree.resolve(a.node)) - tree.depth(tree.resolve(b.node)));
			// Consolidate authored questions atomically before ancestor suppression.
			// Simultaneous covered sets can otherwise delete each other and all their answers.
			for (const question of questions) {
				if (!close.includes(question)) {
					continue;
				}
				const target = tree.resolve(question.node);
				close = close.filter(candidate => !related(target, tree.resolve(candidate.node)));
			}
			close.sort((a, b) => b.score - a.score || tree.depth(tree.resolve(a.node)) - tree.depth(tree.resolve(b.node)));
			const independent: Candidate[] = [];
			for (const candidate of close) {
				if (!independent.some(kept => related(tree.resolve(kept.node), tree.resolve(candidate.node)))) {
					independent.push(candidate);
				}
			}
			close = independent;
		}

		if (close.length === 0) {
			return { kind: 'none' };
		}
		if (close.length === 1) {
			return { kind: 'node', node: close[0].node };
		}
		return { kind: 'ambiguous', candidates: close.slice(0, MAX_SUGGESTIONS).map(candidate => candidate.node) };
	}

	private async open (user: DialogUser, tree: ContentTree, node: ContentNode): Promise<Reply[]> {
		const target = tree.resolve(node);
		// Конец цепочки: отдельным сообщением бот спрашивает, нужно ли что-то еще
		const anythingElse: Reply[] = this.isFinal(tree, target) ? [{ text: tree.settings['text.anythingElse'] }] : [];

		const displayed = target.type === 'link' ? [] : tree.visibleChildren(target);
		await this.sessions.set(user.id, { nodeId: target.id, choices: displayed.map(option => option.id) });

		// Ссылка: в сессии остается сама ссылка, чтобы «назад» вернул в раздел, где она лежит
		if (target.type === 'link') {
			return [{ text: target.text ?? this.optionLine(tree, node) }, ...anythingElse];
		}

		return [this.render(tree, target), ...anythingElse];
	}

	// Конечный ответ — раздел без вариантов ответа или ссылка
	private isFinal (tree: ContentTree, node: ContentNode): boolean {
		return node.id !== tree.root.id && (node.type === 'link' || tree.visibleChildren(node).every(child => tree.resolve(child).type === 'link'));
	}

	render (tree: ContentTree, node: ContentNode): Reply {
		const text = node.text ?? `<b>${escapeHtml(node.title)}</b>`;

		return {
			text: this.withOptions(tree, text, tree.visibleChildren(node)),
			...node.image ? { image: node.image } : {},
			...node.file ? { file: { path: node.file, name: node.fileName ?? node.file } } : {},
		};
	}

	// Варианты ответа перечисляются в тексте сообщения: пользователь отвечает своими словами или номером.
	// Вопрос («…интересует?», «…по темам:») и его варианты — один блок, без пустой строки между ними;
	// после адреса или примечания список ссылок отделяется пустой строкой
	private withOptions (tree: ContentTree, text: string, options: ContentNode[], distinguishBranches = false): string {
		if (options.length === 0) {
			return text;
		}

		const separator = /[?:]\s*$/.test(text) ? '\n' : '\n\n';
		const qualify = distinguishBranches && new Set(options.map(node => node.parentId)).size > 1;

		return `${text}${separator}${options.map((option, i) => `${i + 1}. ${this.optionLine(tree, option, qualify)}`).join('\n')}`;
	}

	// Only the exact last displayed list is selectable. Never resurrect an unseen parent menu.
	private isRootMenu (tree: ContentTree, current: ContentNode | undefined, offered: ContentNode[]): boolean {
		const rootMenu = tree.visibleChildren(tree.root);
		return current?.id === tree.root.id && offered.length === rootMenu.length &&
			rootMenu.every(node => offered.some(option => option.id === node.id));
	}

	private optionsByWords (shown: ContentNode[], normalized: string): ContentNode[] {
		const words = normalized.split(' ').filter(Boolean);
		if (words.length === 0) {
			return [];
		}
		return shown.filter(option => {
			const title = new Set(normalize(option.title).split(' '));
			return words.every(word => title.has(word));
		});
	}

	private shownOptions (tree: ContentTree, session: Session): ContentNode[] {
		return (session.choices ?? []).map(id => tree.get(id)).filter(node => node !== undefined);
	}

	private optionLine (tree: ContentTree, node: ContentNode, qualify = false): string {
		const target = tree.resolve(node);
		const parents: string[] = [];
		if (qualify) {
			for (let parent = tree.parent(node); parent && parent.id !== tree.root.id; parent = tree.parent(parent)) {
				parents.unshift(parent.title);
			}
		}
		const title = escapeHtml(parents.length > 0 ? `${node.title} (${parents.join(' / ')})` : node.title);

		return target.type === 'link' && target.url ? `<a href="${escapeHtml(target.url)}">${title}</a>` : title;
	}
}
