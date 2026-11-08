import type { AdminRole } from '@rw/core';

export const STAFF_ROLES: AdminRole[] = ['superadmin', 'admin', 'support'];

export const MIN_PASSWORD_LENGTH = 8;

// Суперадмин входит и без MAX: кто-то должен попасть в админку и сбросить привязки, если бот или MAX не работают
export const requiresMaxLink = (role: AdminRole, maxLinked: boolean): boolean => role !== 'superadmin' && !maxLinked;

// Суперадмин управляет всеми, админ — только поддержкой
export const canManageRole = (actor: AdminRole, target: AdminRole): boolean =>
	actor === 'superadmin' || (actor === 'admin' && target === 'support');
