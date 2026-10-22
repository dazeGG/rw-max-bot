import winston from 'winston';

import { repoPath } from './paths';

// Журнал ошибок пишется в logs/ (ТЗ п. 5.7): дата, код и текст ошибки.
// У каждого приложения свои файлы: два процесса не должны ротировать один файл
export const createLogger = (app: string) => winston.createLogger({
	level: process.env.LOG_LEVEL ?? 'info',
	format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
	transports: [
		new winston.transports.Console({
			format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
		}),
		new winston.transports.File({ filename: repoPath('logs', `${app}-error.log`), level: 'error', maxsize: 10_000_000, maxFiles: 5 }),
		new winston.transports.File({ filename: repoPath('logs', `${app}.log`), maxsize: 10_000_000, maxFiles: 5 }),
	],
});

export type Logger = winston.Logger;

export const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);
