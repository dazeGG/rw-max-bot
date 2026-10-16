// Симулятор чата в консоли: проверка диалогов без MAX и без токена.
//
//   pnpm chat                                    — интерактивно
//   pnpm chat "как купить билет" "якутск"        — прогнать готовые реплики
//
// Текст — сообщение пользователя, «?фраза» — показать баллы разделов для фразы (для подбора синонимов).
// По умолчанию контент берется из seed-data.ts; с флагом --db — из PostgreSQL.

import 'dotenv/config';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { ContentTree } from '~/content/tree';
import { flattenSeed, SEED_SETTINGS } from '~/content/seed-data';
import { DialogEngine } from '~/dialog/engine';
import { rank } from '~/dialog/matcher';
import { MemorySessionStore } from '~/dialog/memory-sessions';
import type { Reply } from '~/dialog/types';

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
	if (!process.argv.includes('--db')) {
		return new ContentTree(flattenSeed(), SEED_SETTINGS);
	}

	const { loadContentFromDb } = await import('~/content/repository');
	const { pool } = await import('~/db');
	const tree = await loadContentFromDb();
	await pool.end();
	return tree;
};

const main = async () => {
	const tree = await loadTree();
	const engine = new DialogEngine(() => tree, new MemorySessionStore(), {
		onUnrecognized: ({ text }) => console.log(dim(`  (в журнал непонятых фраз: «${text}»)`)),
	});
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
			const top = rank(tree, tree.all().filter(node => node.type !== 'goto'), line.slice(1)).slice(0, 6);
			top.forEach(c => console.log(dim(`  ${c.score.toFixed(2)}  ${c.node.code}  «${c.node.title}»`)));
			return;
		}

		print(await engine.handle(user, { type: 'text', text: line }));
	};

	console.log(dim('Симулятор чата ЖДЯ-бота. Пишите сообщения, Ctrl+C — выход.'));
	print(await engine.handle(user, { type: 'start' }));

	const scripted = process.argv.slice(2).filter(arg => arg !== '--db');

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

void main();
