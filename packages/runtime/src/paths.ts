import path from 'node:path';

// Корень монорепозитория: приложения запускаются из своих папок, а .env, media и logs — общие
export const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

export const repoPath = (...segments: string[]): string => path.resolve(REPO_ROOT, ...segments);
