// Живые подключения чата (SSE). Экземпляр API один, поэтому брокер сообщений не нужен.
// В событии нет ни текста, ни имен, только номер обращения: данные браузер читает обычным запросом,
// где каждый раз проверяются вход и роль. Поэтому отключенный сотрудник не получит из потока ничего

import type { ServerResponse } from 'node:http';

import type { SupportEvent } from '@rw/core';

const KEEP_ALIVE_MS = 25_000;

const streams = new Map<ServerResponse, number>();
let keepAlive: NodeJS.Timeout | null = null;

const write = (stream: ServerResponse, chunk: string) => {
	stream.write(chunk);
};

const stopIfIdle = () => {
	if (streams.size === 0 && keepAlive) {
		clearInterval(keepAlive);
		keepAlive = null;
	}
};

export const addStream = (stream: ServerResponse, adminId: number) => {
	streams.set(stream, adminId);
	stream.on('close', () => {
		streams.delete(stream);
		stopIfIdle();
	});
	// Сотрудник мог закрыть вкладку в момент записи: это не повод останавливать сервер
	stream.on('error', () => streams.delete(stream));

	// Прокси закрывают молчащие соединения, а браузер по этому сигналу понимает, что соединение живо
	keepAlive ??= setInterval(() => {
		for (const open of streams.keys()) {
			write(open, 'event: ping\ndata: 1\n\n');
		}
	}, KEEP_ALIVE_MS).unref();
};

export const publish = (event: SupportEvent) => {
	const chunk = `data: ${JSON.stringify(event)}\n\n`;

	for (const stream of streams.keys()) {
		write(stream, chunk);
	}
};

// Сразу убираем из списка: запись в уже завершенный ответ привела бы к ошибке
const finish = (stream: ServerResponse) => {
	streams.delete(stream);
	stream.end();
	stopIfIdle();
};

// Сотрудника отключили или все его входы завершены
export const disconnectAdmin = (adminId: number) => {
	for (const [stream, owner] of streams) {
		if (owner === adminId) {
			finish(stream);
		}
	}
};

// Иначе открытые соединения не дадут серверу остановиться
export const closeStreams = () => {
	for (const stream of streams.keys()) {
		finish(stream);
	}
};
