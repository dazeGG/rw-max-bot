import { describe, expect, it } from 'vitest';

import { canManageRole, requiresMaxLink } from './permissions';

describe('обязательная привязка MAX', () => {
	it('закрывает админку поддержке и админу без привязки', () => {
		expect(requiresMaxLink('support', false)).toBe(true);
		expect(requiresMaxLink('admin', false)).toBe(true);
	});

	it('не мешает после привязки', () => {
		expect(requiresMaxLink('support', true)).toBe(false);
		expect(requiresMaxLink('admin', true)).toBe(false);
	});

	it('суперадмин входит и без привязки', () => {
		expect(requiresMaxLink('superadmin', false)).toBe(false);
	});
});

describe('права на управление сотрудниками', () => {
	it('суперадмин управляет всеми', () => {
		expect(canManageRole('superadmin', 'superadmin')).toBe(true);
		expect(canManageRole('superadmin', 'admin')).toBe(true);
		expect(canManageRole('superadmin', 'support')).toBe(true);
	});

	it('админ управляет только поддержкой', () => {
		expect(canManageRole('admin', 'support')).toBe(true);
		expect(canManageRole('admin', 'admin')).toBe(false);
		expect(canManageRole('admin', 'superadmin')).toBe(false);
	});

	it('поддержка никем не управляет', () => {
		expect(canManageRole('support', 'support')).toBe(false);
	});
});
