import type { ContentTree } from '../content/tree';
import type { ContentNode } from '../content/types';

import { rank } from './matcher';
import type { Candidate } from './matcher';
import { escapeHtml, stripGreeting } from './text';
import type { DialogEvents, DialogInput, DialogUser, Reply, Session, SessionStore } from './types';

// Пороги подобраны на тестовых диалогах (src/dialog/engine.test.ts)
const THRESHOLD = 0.6;
// Среди 2–3 предложенных вариантов достаточно частичного совпадения: «поезд» → «Поезд №317/№318 …»
const SUGGESTION_THRESHOLD = 0.4;
// Прибавка за контекст: ответ на вопрос текущего раздела или соседний пункт после конечного ответа
const CHILD_BONUS = 0.2;
const SIBLING_BONUS = 0.1;
// Если второй кандидат ближе этого зазора к первому, бот переспрашивает
const AMBIGUITY_GAP = 0.1;
const MAX_SUGGESTIONS = 3;

const BACK_WORDS = new Set(['назад', 'вернуться', 'вернуться назад', 'обратно']);
const HOME_WORDS = new Set(['меню', 'главное меню', 'в начало', 'начало', 'старт', 'start', 'в меню', 'вернуться в меню']);

type Choice =
	| { kind: 'node'; node: ContentNode; }
	| { kind: 'ambiguous'; candidates: ContentNode[]; }
	| { kind: 'none'; };

export class DialogEngine {
	constructor (
		private readonly getTree: () => ContentTree,
		private readonly sessions: SessionStore,
		private readonly events: DialogEvents = {},
	) {}

	async handle (user: DialogUser, input: DialogInput): Promise<Reply[]> {
		const tree = this.getTree();

		if (input.type === 'start') {
			return this.open(user, tree, tree.root);
		}

		const session = await this.sessions.get(user.id);
		const current = tree.get(session.nodeId) ?? tree.root;

		return this.handleText(user, tree, current, session, input.text);
	}

	private async handleText (user: DialogUser, tree: ContentTree, current: ContentNode, session: Session, text: string): Promise<Reply[]> {
		const { greeting, rest } = stripGreeting(text);
		const greetingReplies: Reply[] = greeting ? [{ text: tree.settings['text.greeting'] }] : [];

		// Чистое приветствие: стартовое сообщение и так начинается с приветствия
		if (rest === '' || rest === 'start') {
			return this.open(user, tree, tree.root);
		}

		if (BACK_WORDS.has(rest)) {
			return this.open(user, tree, tree.parent(current) ?? tree.root);
		}

		if (HOME_WORDS.has(rest)) {
			return this.open(user, tree, tree.root);
		}

		const choice = this.choose(tree, current, session, rest);

		switch (choice.kind) {
		case 'node':
			return [...greetingReplies, ...await this.open(user, tree, choice.node)];

		case 'ambiguous':
			await this.sessions.set(user.id, { nodeId: current.id, choices: choice.candidates.map(node => node.id) });
			return [...greetingReplies, { text: this.withOptions(tree, tree.settings['text.didYouMean'], choice.candidates) }];

		case 'none':
			await this.events.onUnrecognized?.({ userId: user.id, text, nodeId: current.id });
			await this.sessions.set(user.id, { nodeId: tree.root.id, choices: [] });
			return [{ text: this.withOptions(tree, tree.settings['text.fallback'], tree.visibleChildren(tree.root)) }];
		}
	}

	private choose (tree: ContentTree, current: ContentNode, session: Session, text: string): Choice {
		// Ответ на «Уточните, пожалуйста…»: сначала среди предложенных вариантов
		const suggested = (session.choices ?? []).map(id => tree.get(id)).filter(node => node !== undefined);

		if (suggested.length > 0) {
			const answer = this.pick(tree, rank(tree, suggested, text), SUGGESTION_THRESHOLD);

			if (answer.kind === 'node') {
				return answer;
			}
		}

		// Поиск по всему дереву с прибавкой за контекст: короткий ответ «нет» или «трансфер»
		// относится к вопросу текущего раздела, а новый вопрос уводит в другую ветку.
		// В главном меню контекста нет: все разделы первого уровня равны
		const inContext = current.id !== tree.root.id;
		const offered = new Set(inContext ? tree.children(current).map(node => node.id) : []);
		const parent = tree.parent(current);
		const siblings = new Set(inContext && offered.size === 0 && parent && parent.id !== tree.root.id
			? tree.children(parent).map(node => node.id)
			: []);
		const bonus = (node: ContentNode) => offered.has(node.id) ? CHILD_BONUS : siblings.has(node.id) ? SIBLING_BONUS : 0;
		// goto-пункты — это варианты ответа на конкретный вопрос («Билет на поезд» в «Возврат билета»):
		// вне своего вопроса они не участвуют, их цель и так есть в поиске
		const everywhere = tree.all().filter(node => node.id !== tree.root.id &&
			(node.type !== 'goto' || offered.has(node.id) || siblings.has(node.id)));

		return this.pick(tree, rank(tree, everywhere, text, bonus));
	}

	private pick (tree: ContentTree, ranked: Candidate[], threshold = THRESHOLD): Choice {
		// Разные пункты могут вести в один раздел (goto) — это не неоднозначность
		const unique: Candidate[] = [];
		const seen = new Set<number>();

		for (const candidate of ranked) {
			const target = tree.resolve(candidate.node);

			if (!seen.has(target.id)) {
				seen.add(target.id);
				unique.push(candidate);
			}
		}

		const [best] = unique;

		if (!best || best.score < threshold) {
			return { kind: 'none' };
		}

		const close = unique.filter(c => best.score - c.score < AMBIGUITY_GAP);

		// Уточняющий вопрос поглощает свои варианты ответа: на «сдать билет» бот спрашивает
		// «билет или талон?», а не выбирает сам между вопросом и одним из ответов
		const covered = new Set(close.flatMap(c => tree.children(tree.resolve(c.node)).map(child => tree.resolve(child).id)));
		const remaining = close.filter(c => !covered.has(tree.resolve(c.node).id));

		if (remaining.length <= 1) {
			return { kind: 'node', node: (remaining[0] ?? best).node };
		}

		return { kind: 'ambiguous', candidates: remaining.slice(0, MAX_SUGGESTIONS).map(c => c.node) };
	}

	private async open (user: DialogUser, tree: ContentTree, node: ContentNode): Promise<Reply[]> {
		const target = tree.resolve(node);

		// Ссылка: в сессии остается сама ссылка, чтобы «назад» вернул в раздел, где она лежит
		if (target.type === 'link') {
			await this.sessions.set(user.id, { nodeId: target.id, choices: [] });
			return [{ text: target.text ?? this.optionLine(tree, node) }];
		}

		await this.sessions.set(user.id, { nodeId: target.id, choices: [] });

		return [this.render(tree, target)];
	}

	render (tree: ContentTree, node: ContentNode): Reply {
		const text = node.text ?? `<b>${escapeHtml(node.title)}</b>`;

		return {
			text: this.withOptions(tree, text, tree.visibleChildren(node)),
			...node.image ? { image: node.image } : {},
			...node.file ? { file: { path: node.file, name: node.fileName ?? node.file } } : {},
		};
	}

	// Варианты ответа перечисляются в тексте сообщения: пользователь отвечает своими словами
	private withOptions (tree: ContentTree, text: string, options: ContentNode[]): string {
		if (options.length === 0) {
			return text;
		}

		return `${text}\n\n${options.map(option => `• ${this.optionLine(tree, option)}`).join('\n')}`;
	}

	private optionLine (tree: ContentTree, node: ContentNode): string {
		const target = tree.resolve(node);
		const title = escapeHtml(node.title);

		return target.type === 'link' && target.url ? `<a href="${escapeHtml(target.url)}">${title}</a>` : title;
	}
}
