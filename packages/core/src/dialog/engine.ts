import type { ContentTree } from '../content/tree';
import type { ContentNode } from '../content/types';

import { DEFAULT_SEARCH_POLICY } from './search';
import type { Candidate, DialogSearch, SearchPolicy } from './search';
import { escapeHtml, stripGreeting } from './text';
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
		const { greeting, rest } = stripGreeting(text);
		const greetingReplies: Reply[] = greeting ? [{ text: tree.settings['text.greeting'] }] : [];
		const shown = this.shownOptions(tree, current, session);
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
		if (rest === '' || rest === 'start') {
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
		if (this.isFinal(tree, current) &&!session.choices?.length) {
			if (YES_WORDS.has(rest)) {
				await this.sessions.set(user.id, { nodeId: tree.root.id, choices: [] });
				return done('more', tree.root, [{ text: this.withOptions(tree, tree.settings['text.askMore'], tree.visibleChildren(tree.root)) }]);
			}

			if (NO_WORDS.has(rest)) {
				await this.sessions.set(user.id, { nodeId: tree.root.id, choices: [] });
				return done('goodbye', tree.root, [{ text: tree.settings['text.goodbye'] }]);
			}
		}

		// Номер варианта из последнего списка: «2» — второй пункт. Номер, которого в списке нет, по тексту не ищется:
		// иначе «5» совпало бы с синонимом «ребенок до 5 лет». Номера поездов (317) — трехзначные, их ищем как текст
		const number = /^\d{1,2}$/.test(rest) ? Number(rest) : null;

		if (number !== null) {
			const option = shown[number - 1];

			if (option) {
				return done('option', tree.resolve(option), await this.open(user, tree, option), { option: number });
			}

			details.unmatchedOption = number;
		}

		const { choice, ranked }: { choice: Choice; ranked: Candidate[]; } = number === null
			? await this.choose(tree, current, session, rest)
			: { choice: { kind: 'none' }, ranked: [] };
		const candidates = ranked.slice(0, MAX_TRACED_CANDIDATES)
			.map(candidate => ({ code: candidate.node.code, score: Math.round(candidate.score * 1000) / 1000 }));

		switch (choice.kind) {
		case 'node':
			return done('answer', tree.resolve(choice.node), [...greetingReplies, ...await this.open(user, tree, choice.node)], { candidates });

		case 'ambiguous':
			await this.sessions.set(user.id, { nodeId: current.id, choices: choice.candidates.map(node => node.id) });
			return done('clarify', current, [...greetingReplies, { text: this.withOptions(tree, tree.settings['text.didYouMean'], choice.candidates) }], {
				candidates,
				suggested: choice.candidates.map(node => node.code),
			});

		case 'none':
			await this.events.onUnrecognized?.({ userId: user.id, text, nodeId: current.id });
			await this.sessions.set(user.id, { nodeId: tree.root.id, choices: [] });
			return done('unrecognized', current, [{ text: this.withOptions(tree, tree.settings['text.fallback'], tree.visibleChildren(tree.root)) }], { candidates });
		}
	}

	private result (type: DialogEventType, node: ContentNode, text: string | null, replies: Reply[], details: DialogEventDetails = {}): DialogResult {
		return { replies, event: { type, nodeId: node.id, nodeCode: node.code, text, details } };
	}

	// ranked — кандидаты того поиска, который принял решение (для статистики)
	private async choose (tree: ContentTree, current: ContentNode, session: Session, text: string): Promise<{ choice: Choice; ranked: Candidate[]; }> {
		// Контекст передаётся модели как данные, без словарей и ручных прибавок к оценкам.
		const inContext = current.id !== tree.root.id;
		const offered = new Set(inContext ? tree.children(current).map(node => node.id) : []);
		const parent = tree.parent(current);
		const siblings = new Set(inContext && offered.size === 0 && parent && parent.id !== tree.root.id
			? tree.children(parent).map(node => node.id)
			: []);
		const suggested = new Set(session.choices ?? []);
		// goto-пункты — это варианты ответа на конкретный вопрос («Билет на поезд» в «Возврат билета»):
		// вне своего вопроса они не участвуют, их цель и так есть в поиске
		const everywhere = tree.all().filter(node => node.id !== tree.root.id &&
			(node.type !== 'goto' || offered.has(node.id) || siblings.has(node.id) || suggested.has(node.id)));
		const context = !inContext ? undefined : this.isFinal(tree, current) ? parent : current;
		const allowed = new Set(everywhere.map(node => node.id));
		const ranked = (await this.search.rank(tree, everywhere, text, context?.id === tree.root.id ? undefined : context))
			.filter(candidate => allowed.has(candidate.node.id) && Number.isFinite(candidate.score))
			.sort((a, b) => b.score - a.score || tree.depth(a.node) - tree.depth(b.node));
		// Короткий ответ на уточнение может выбирать из уже предложенного списка,
		// но только если E5 оценила его почти так же высоко, как лучший глобальный ответ.
		// Новая тема с заметно лучшей оценкой и полные вопросы не перехватываются.
		if (suggested.size > 0 && text.split(/\s+/).length <= 4) {
			const narrowed = ranked.filter(candidate => suggested.has(candidate.node.id));
			const best = ranked[0];
			const suggestion = narrowed[0];

			if (best && suggestion && suggestion.score >= this.policy.threshold && best.score - suggestion.score <= this.policy.ambiguityGap) {
				return { choice: this.pick(tree, narrowed), ranked: narrowed };
			}
		}

		return { choice: this.pick(tree, ranked), ranked };
	}

	private pick (tree: ContentTree, ranked: Candidate[]): Choice {
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

		if (!best || best.score < this.policy.threshold) {
			return { kind: 'none' };
		}

		const close = unique.filter(c => c.score >= this.policy.threshold && best.score - c.score < this.policy.ambiguityGap);

		// Между общим вопросом и любым вложенным ответом сохраняем более высокий результат E5.
		// Только при равных оценках предпочтителен родительский уточняющий вопрос.
		const byTarget = new Map(close.map(candidate => [tree.resolve(candidate.node).id, candidate]));
		const descendants = (parent: ContentNode): number[] => {
			const seen = new Set([parent.id]);
			const pending = [parent];
			const result: number[] = [];

			while (pending.length > 0) {
				for (const child of tree.children(pending.pop()!)) {
					const target = tree.resolve(child);

					if (seen.has(target.id)) {
						continue;
					}

					seen.add(target.id);
					result.push(target.id);
					pending.push(target);
				}
			}

			return result;
		};
		const covered = new Set<number>();

		for (const candidate of close) {
			const parent = tree.resolve(candidate.node);

			for (const targetId of descendants(parent)) {
				const childCandidate = byTarget.get(targetId);

				if (!childCandidate) {
					continue;
				}

				covered.add(candidate.score >= childCandidate.score ? targetId : parent.id);
			}
		}

		const remaining = close.filter(candidate => !covered.has(tree.resolve(candidate.node).id));

		if (remaining.length <= 1) {
			return { kind: 'node', node: (remaining[0] ?? best).node };
		}

		return { kind: 'ambiguous', candidates: remaining.slice(0, MAX_SUGGESTIONS).map(c => c.node) };
	}

	private async open (user: DialogUser, tree: ContentTree, node: ContentNode): Promise<Reply[]> {
		const target = tree.resolve(node);
		// Конец цепочки: отдельным сообщением бот спрашивает, нужно ли что-то еще
		const anythingElse: Reply[] = this.isFinal(tree, target) ? [{ text: tree.settings['text.anythingElse'] }] : [];

		await this.sessions.set(user.id, { nodeId: target.id, choices: [] });

		// Ссылка: в сессии остается сама ссылка, чтобы «назад» вернул в раздел, где она лежит
		if (target.type === 'link') {
			return [{ text: target.text ?? this.optionLine(tree, node) }, ...anythingElse];
		}

		return [this.render(tree, target), ...anythingElse];
	}

	// Конечный ответ — раздел без вариантов ответа или ссылка
	private isFinal (tree: ContentTree, node: ContentNode): boolean {
		return node.id !== tree.root.id && (node.type === 'link' || tree.visibleChildren(node).length === 0);
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
	private withOptions (tree: ContentTree, text: string, options: ContentNode[]): string {
		if (options.length === 0) {
			return text;
		}

		const separator = /[?:]\s*$/.test(text) ? '\n' : '\n\n';

		return `${text}${separator}${options.map((option, i) => `${i + 1}. ${this.optionLine(tree, option)}`).join('\n')}`;
	}

	// Список, на который ссылается номер в ответе: варианты уточнения или пункты текущего раздела
	// (после «не понял» сессия стоит в главном меню, и показаны как раз его пункты).
	// После конечного ответа своего списка нет: номер относится к списку, из которого этот ответ выбрали
	private shownOptions (tree: ContentTree, current: ContentNode, session: Session): ContentNode[] {
		const suggested = (session.choices ?? []).map(id => tree.get(id)).filter(node => node !== undefined);

		if (suggested.length > 0) {
			return suggested;
		}

		const options = tree.visibleChildren(current);

		return options.length === 0 && current.id !== tree.root.id
			? tree.visibleChildren(tree.parent(current) ?? tree.root)
			: options;
	}

	private optionLine (tree: ContentTree, node: ContentNode): string {
		const target = tree.resolve(node);
		const title = escapeHtml(node.title);

		return target.type === 'link' && target.url ? `<a href="${escapeHtml(target.url)}">${title}</a>` : title;
	}
}
