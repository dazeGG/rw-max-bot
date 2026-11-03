// Шаблоны ответов сотрудника. Чужие шаблоны не видны и не меняются: для них ответ такой же, как для несуществующих

import { and, asc, eq, ne, sql } from 'drizzle-orm';

import type { AdminUser, SupportTemplate, SupportTemplateRequest } from '@rw/core';
import { db, supportTemplates } from '@rw/db';

import { RuleError } from './errors';

const columns = {
	id: supportTemplates.id,
	title: supportTemplates.title,
	command: supportTemplates.command,
	text: supportTemplates.text,
};

const clean = ({ title, command, text }: SupportTemplateRequest) => ({
	title: title.trim(),
	// Команду ищут без учета регистра: две команды не должны отличаться только им
	command: command.toLowerCase(),
	text: text.trim(),
});

const taken = (command: string) => new RuleError(409, `Команда /${command} уже есть в ваших шаблонах`);

export const listTemplates = (actor: AdminUser): Promise<SupportTemplate[]> => db.select(columns).from(supportTemplates)
	.where(eq(supportTemplates.adminId, actor.id))
	.orderBy(asc(supportTemplates.title), asc(supportTemplates.id));

export const createTemplate = async (body: SupportTemplateRequest, actor: AdminUser): Promise<SupportTemplate> => {
	const values = clean(body);
	const [created] = await db.insert(supportTemplates)
		.values({ ...values, adminId: actor.id })
		.onConflictDoNothing({ target: [supportTemplates.adminId, supportTemplates.command] })
		.returning(columns);

	if (!created) {
		throw taken(values.command);
	}

	return created;
};

export const updateTemplate = async (id: number, body: SupportTemplateRequest, actor: AdminUser): Promise<SupportTemplate> => {
	const values = clean(body);
	const [same] = await db.select({ id: supportTemplates.id }).from(supportTemplates)
		.where(and(eq(supportTemplates.adminId, actor.id), eq(supportTemplates.command, values.command), ne(supportTemplates.id, id)));

	if (same) {
		throw taken(values.command);
	}

	const [updated] = await db.update(supportTemplates)
		.set({ ...values, updatedAt: sql`now()` })
		.where(and(eq(supportTemplates.id, id), eq(supportTemplates.adminId, actor.id)))
		.returning(columns);

	if (!updated) {
		throw new RuleError(404, 'Шаблон не найден');
	}

	return updated;
};

export const deleteTemplate = async (id: number, actor: AdminUser) => {
	const [deleted] = await db.delete(supportTemplates)
		.where(and(eq(supportTemplates.id, id), eq(supportTemplates.adminId, actor.id)))
		.returning({ id: supportTemplates.id });

	if (!deleted) {
		throw new RuleError(404, 'Шаблон не найден');
	}
};
