import winston from 'winston';

// Журнал ошибок пишется в logs/ (ТЗ п. 5.7): дата, код и текст ошибки
export const logger = winston.createLogger({
	level: process.env.LOG_LEVEL ?? 'info',
	format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
	transports: [
		new winston.transports.Console({
			format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
		}),
		new winston.transports.File({ filename: 'logs/error.log', level: 'error', maxsize: 10_000_000, maxFiles: 5 }),
		new winston.transports.File({ filename: 'logs/app.log', maxsize: 10_000_000, maxFiles: 5 }),
	],
});
