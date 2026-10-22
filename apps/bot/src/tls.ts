// API MAX (platform-api2.max.ru) подписан сертификатом НУЦ Минцифры (Russian Trusted Root CA),
// которого нет в стандартном наборе Node.js. Добавляем его к доверенным только для процесса бота,
// не трогая системное хранилище сертификатов.
//
// Node.js < 22.19 не умеет tls.setDefaultCACertificates — там запускайте с переменной окружения
// NODE_EXTRA_CA_CERTS=<абсолютный путь к apps/bot/certs/russian_trusted_root_ca.pem> (или установите сертификат в систему).

import fs from 'node:fs';
import path from 'node:path';
import tls from 'node:tls';

const CERTS = ['russian_trusted_root_ca.pem', 'russian_trusted_sub_ca.pem'];

const setDefaults = (tls as { setDefaultCACertificates?: (certs: string[]) => void; }).setDefaultCACertificates;
const getCertificates = (tls as { getCACertificates?: (type: 'default') => string[]; }).getCACertificates;

if (setDefaults && getCertificates) {
	const extra = CERTS.map(file => fs.readFileSync(path.resolve(import.meta.dirname, '../certs', file), 'utf8'));
	setDefaults([...getCertificates('default'), ...extra]);
}
