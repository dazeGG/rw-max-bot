import { describe, expect, it } from 'vitest';

import { canManageRole } from './permissions';

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
