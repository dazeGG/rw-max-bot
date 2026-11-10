// Проверка поиска из админки: как бот ответит на фразу, если спросить из главного меню.
// Отдельный движок с пустой памятью: сессии пассажиров и статистика не меняются

import type { SearchCheckNode, SearchCheckResult } from '../api';
import type { ContentTree } from '../content/tree';

import { DialogEngine } from './engine';
import { MemorySessionStore } from './memory-sessions';
import type { DialogSearch, SearchPolicy } from './search';
import { OPERATOR_CODE } from './support';

const CHECK_USER = { id: 0 };

export const checkSearch = async (getTree: () => ContentTree, search: DialogSearch, policy: SearchPolicy, text: string): Promise<SearchCheckResult> => {
	const tree = getTree();
	const engine = new DialogEngine(() => tree, new MemorySessionStore(), search, {}, policy);
	const { event } = await engine.process(CHECK_USER, { type: 'text', text });

	const byCode = (code: string | null | undefined): SearchCheckNode | null => {
		const node = code ? tree.getByCode(code) : undefined;
		return node ? { id: node.id, title: node.title } : null;
	};

	switch (event.type) {
	case 'answer': {
		const node = byCode(event.nodeCode);
		return node ? { kind: 'answer', node } : { kind: 'none' };
	}

	// Поиск открыл бы обращение сразу
	case 'operator': {
		const node = byCode(OPERATOR_CODE);
		return node ? { kind: 'answer', node } : { kind: 'none' };
	}

	case 'clarify':
		return {
			kind: 'clarify',
			options: (event.details.suggested ?? []).map(byCode).filter(node => node !== null),
			handoff: event.details.handoff
				? tree.settings[event.details.handoff === OPERATOR_CODE ? 'text.handoffOperator' : 'text.handoff']
				: null,
		};

	case 'unrecognized':
		return { kind: 'none' };

	// Служебные слова и приветствие до поиска не доходят
	default:
		return { kind: 'service' };
	}
};
