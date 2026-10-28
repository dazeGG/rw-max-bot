// Explicit opt-in model evaluation. Unit tests do not download or run E5.
import fs from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

import { ContentTree, DialogEngine, flattenSeed, MemorySessionStore, SEED_SETTINGS } from '@rw/core';
import { repoPath } from '@rw/runtime';

import { semanticPolicy } from '../semantic-config';
import { createE5Search, E5_MODEL, E5_REVISION } from '../semantic-search';

type Example = { messages: string[]; expected: string; };
const examples: Example[] = [
	{ messages: ['купить билет'], expected: 'buy' },
	{ messages: ['как купить билеты онлайн'], expected: 'buy-online' },
	{ messages: ['сколько стоит детский билет'], expected: 'faq-child' },
	{ messages: ['можно ли ехать с собакой'], expected: 'faq-pets' },
	{ messages: ['могу ли взять с собой кота'], expected: 'faq-pets' },
	{ messages: ['забыл рюкзак в вагоне'], expected: 'forgotten' },
	{ messages: ['я потерял вещи в поезде'], expected: 'forgotten' },
	{ messages: ['телефон службы поддержки'], expected: 'support' },
	{ messages: ['подскажите телефон справочной'], expected: 'support' },
	{ messages: ['где поесть в поезде'], expected: 'onboard-dining' },
	{ messages: ['за сколько дней продают билеты'], expected: 'faq-sale-start' },
	{ messages: ['справка о стоимости проезда'], expected: 'faq-certificate' },
	{ messages: ['хочу сдать билет'], expected: 'refund' },
	{ messages: ['как вернуть билет на поезд'], expected: 'faq-refund' },
	{ messages: ['сколько стоит билет'], expected: 'tariffs' },
	{ messages: ['трансфер', 'расписание'], expected: 'transfer-schedule' },
	{ messages: ['трансфер', '1'], expected: 'transfer-schedule' },
	{ messages: ['расписание', 'меню'], expected: 'root' },
	{ messages: ['какая погода завтра'], expected: 'unrecognized' },
	{ messages: ['как приготовить борщ'], expected: 'unrecognized' },
	{ messages: ['напиши программу на питоне'], expected: 'unrecognized' },
	{ messages: ['асдфыва'], expected: 'unrecognized' },
];

const main = async () => {
	const tree = new ContentTree(flattenSeed(), SEED_SETTINGS);
	const search = await createE5Search();
	await search.prepare(tree);
	const results = [];
	for (const example of examples) {
		const engine = new DialogEngine(() => tree, new MemorySessionStore(), search, {}, semanticPolicy);
		const started = performance.now();
		let result = await engine.process({ id: 1 }, { type: 'start' });
		for (const text of example.messages) {
			result = await engine.process({ id: 1 }, { type: 'text', text });
		}
		const accepted = [...new Set(result.event.type === 'clarify'
			? (result.event.details.suggested ?? []).flatMap(code => {
				const node = tree.getByCode(code)!;
				return [code, tree.resolve(node).code];
			})
			: [result.event.type === 'unrecognized' ? 'unrecognized' : result.event.nodeCode])];
		const pass = accepted.includes(example.expected);
		const row = {
			...example,
			pass,
			type: result.event.type,
			actual: accepted,
			milliseconds: Math.round(performance.now() - started),
			candidates: result.event.details.candidates,
		};
		results.push(row);
		console.log(`${pass ? 'OK  ' : 'MISS'} ${example.messages.join(' → ')}: ${row.type} [${accepted.join(', ')}], expected ${example.expected}`);
	}
	const passed = results.filter(row => row.pass).length;
	const report = { model: E5_MODEL, revision: E5_REVISION, policy: semanticPolicy, passed, total: results.length, results };
	await fs.mkdir(repoPath('.cache'), { recursive: true });
	await fs.writeFile(repoPath('.cache/e5-evaluation.json'), JSON.stringify(report, null, 2));
	console.log(`\n${passed}/${results.length}: correct answer or relevant clarification. Report: .cache/e5-evaluation.json`);
	if (process.argv.includes('--strict') && passed !== results.length) {
		process.exitCode = 1;
	}
};

void main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
