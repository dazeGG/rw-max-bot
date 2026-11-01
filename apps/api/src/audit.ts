import type { AdminUser } from '@rw/core';
import type { db } from '@rw/db';
import { auditLog } from '@rw/db';

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const writeAudit = (tx: Tx, actor: AdminUser, action: string, targetId: number, details: Record<string, unknown>) =>
	tx.insert(auditLog).values({ actorId: actor.id, action, targetId, details });
