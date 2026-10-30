// Симулятор чата в консоли: проверка диалогов без MAX и без токена.
//
//   pnpm chat                                    — интерактивно
//   pnpm chat "как купить билет" "якутск"        — прогнать готовые реплики
//
// Текст — сообщение пользователя, «?фраза» — показать семантические оценки E5.
// По умолчанию контент берется из seed-data.ts; с флагом --api — из запущенного API (как у бота).

import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { ContentTree, DialogEngine, flattenSeed, MemorySessionStore, SEED_SETTINGS } from '@rw/core';
import type { Reply } from '@rw/core';

import { ApiClient } from '../api-client';
import { apiConfig } from '../api-config';
import { rerankDepth, rerankE5Weight, semanticPolicy } from '../semantic-config';
import { createE5Search } from '../semantic-search';

const bold = (text: string) => `\x1b[1m${text}\x1b[22m`;
const dim = (text: string) => `\x1b[2m${text}\x1b[22m`;

const htmlToTerminal = (html: string): string => html
	.replace(/<a\s+href="([^"]*)"[^>]*>(.*?)<\/a>/gs, (_, url: string, label: string) => `${label} ${dim(`(${url})`)}`)
	.replace(/<b>(.*?)<\/b>/gs, (_, text: string) => bold(text))
	.replace(/<[^>]+>/g, '')
	.replace(/&lt;/g, '<')
	.replace(/&gt;/g, '>')
	.replace(/&amp;/g, '&');

const loadTree = async (): Promise<ContentTree> => {
	if (!process.argv.includes('--api')) {
		return new ContentTree(flattenSeed(), SEED_SETTINGS);
	}

	const snapshot = await new ApiClient(apiConfig.url, apiConfig.token).getContent();
	return new ContentTree(snapshot!.nodes, snapshot!.settings);
};

const main = async () => {
	const tree = await loadTree();
	console.log(dim('Загрузка E5 (первый запуск скачивает модель, следующие используют локальный кеш)…'));
	const search = await createE5Search(rerankDepth, rerankE5Weight);
	await search.prepare(tree);
	const engine = new DialogEngine(() => tree, new MemorySessionStore(), search, {
		onUnrecognized: ({ text }) => console.log(dim(`  (в журнал непонятых фраз: «${text}»)`)),
	}, semanticPolicy);
	const user = { id: 1, firstName: 'Тест' };

	const print = (replies: Reply[]) => {
		for (const reply of replies) {
			console.log(`\n${htmlToTerminal(reply.text)}`);

			if (reply.image) {
				console.log(dim(`  [картинка: media/${reply.image}]`));
			}

			if (reply.file) {
				console.log(dim(`  [файл: ${reply.file.name}]`));
			}
		}
	};

	const send = async (line: string) => {
		// «?фраза» — показать, как бот оценивает разделы для этой фразы
		if (line.startsWith('?')) {
			const top = (await search.rank(tree, tree.all().filter(node => node.id !== tree.root.id && node.type !== 'goto'), line.slice(1))).slice(0, 6);
			top.forEach(c => console.log(dim(`  ${c.score.toFixed(2)}  ${c.node.code}  «${c.node.title}»`)));
			return;
		}

		print(await engine.handle(user, { type: 'text', text: line }));
	};

	console.log(dim('Симулятор чата ЖДЯ-бота. Пишите сообщения, Ctrl+C — выход.'));
	print(await engine.handle(user, { type: 'start' }));

	const scripted = process.argv.slice(2).filter(arg => arg !== '--api');

	if (scripted.length > 0) {
		for (const line of scripted) {
			console.log(`\n${bold('> ' + line)}`);
			await send(line);
		}
		return;
	}

	const rl = readline.createInterface({ input: stdin, output: stdout });

	for (;;) {
		const line = await rl.question(`\n${bold('> ')}`);

		if (line.trim()) {
			await send(line);
		}
	}
};

void main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
