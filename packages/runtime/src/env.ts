// Импортируется первым: подхватывает общий .env из корня репозитория.
// Уже заданные переменные окружения (на сервере) не перезаписываются.

import { config } from 'dotenv';

import { repoPath } from './paths';

config({ path: repoPath('.env'), quiet: true });
