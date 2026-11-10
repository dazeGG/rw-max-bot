// Просьбы позвать оператора: сколько находятся сразу, сколько уточнением с пунктом оператора и нет ли ложных переходов.
// Модель и политика те же, что у бота (RERANK_DEPTH=0 — как на дев-стенде). Чат поддержки считается включенным:
// пункт operator есть в дереве, как и в оценочных деревьях.
//
//   pnpm --filter @rw/bot eval:operator [--strict]
import { DialogEngine, MemorySessionStore, OPERATOR_CODE } from '@rw/core';
import type { DialogResult } from '@rw/core';

import { createEvaluationTrees } from '../evaluation/fixtures';
import type { Step } from '../evaluation/fixtures';
import { notOperatorRequests, operatorRequests } from '../evaluation/operator-requests';
import { rerankDepth, rerankE5Weight, semanticPolicy } from '../semantic-config';
import { createE5Search } from '../semantic-search';

const describeResult = (result: DialogResult) => {
	const { event } = result;
	const suggested = event.details.suggested ?? [];

	if (event.type === 'operator') {
		return 'оператор сразу';
	}

	if (event.type === 'clarify') {
		return `уточнение: ${suggested.join(', ')}${event.details.handoff ? ` + пункт «${event.details.handoff}»` : ''}`;
	}

	return event.type === 'answer' ? `ответ: ${event.nodeCode}` : event.type;
};

const main = async () => {
	const tree = createEvaluationTrees().railway;

	if (!tree.getByCode(OPERATOR_CODE)) {
		throw new Error('В оценочном дереве нет пункта оператора: чат поддержки должен быть включен');
	}

	const search = await createE5Search(rerankDepth, rerankE5Weight);
	await search.prepare(tree);
	const run = async (step: Step) => {
		const engine = new DialogEngine(() => tree, new MemorySessionStore(), search, {}, semanticPolicy);
		await engine.process({ id: 1 }, { type: 'start' });
		return engine.process({ id: 1 }, { type: 'text', text: step.text });
	};

	let direct = 0;
	let offered = 0;
	let falseDirect = 0;
	let falseOffered = 0;
	console.log(`Реранкер: глубина ${rerankDepth}\n\nПросьбы позвать оператора:`);
	for (const step of operatorRequests) {
		const result = await run(step);
		const isDirect = result.event.type === 'operator';
		const isOffered = !isDirect && result.event.type === 'clarify' && (result.event.details.suggested ?? []).includes(OPERATOR_CODE);
		direct += isDirect ? 1 : 0;
		offered += isOffered ? 1 : 0;
		console.log(`${isDirect || isOffered ? 'OK  ' : 'MISS'} ${step.text} => ${describeResult(result)}`);
	}
	console.log('\nПохожие, но другие фразы:');
	for (const step of notOperatorRequests) {
		const result = await run(step);
		const isDirect = result.event.type === 'operator';
		const isOffered = result.event.type === 'clarify' && (result.event.details.suggested ?? []).includes(OPERATOR_CODE);
		falseDirect += isDirect ? 1 : 0;
		falseOffered += isOffered ? 1 : 0;
		console.log(`${isDirect ? 'FAIL' : 'OK  '} ${step.text} => ${describeResult(result)}${isOffered ? ' (оператор среди вариантов)' : ''}`);
	}
	console.log(`\nПозитивы: сразу ${direct}, уточнением ${offered}, не найдено ${operatorRequests.length - direct - offered} из ${operatorRequests.length}`);
	console.log(`Негативы: ложных прямых переходов ${falseDirect}, оператор среди вариантов ${falseOffered} из ${notOperatorRequests.length}`);

	if (process.argv.includes('--strict') && (falseDirect > 0 || direct + offered < operatorRequests.length)) {
		process.exitCode = 1;
	}
};

void main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
