// \b в JS не работает с кириллицей, поэтому граница слова — пробел или конец строки
const GREETING = /^(здравствуйте|здравствуй|здрасте|привет|приветствую|добрый (день|вечер)|доброе утро|доброго (дня|времени суток)|доброй ночи|hello|hi)(?= |$) ?/;

export const normalize = (text: string): string => text
	.toLowerCase()
	.replace(/ё/g, 'е')
	.replace(/<[^>]*>/g, ' ')
	.replace(/[^a-zа-я0-9\s-]/g, ' ')
	.replace(/-/g, ' ')
	.replace(/\s+/g, ' ')
	.trim();

export const stripGreeting = (text: string): { greeting: boolean; rest: string } => {
	const normalized = normalize(text);
	const match = GREETING.exec(normalized);

	if (!match) {
		return { greeting: false, rest: normalized };
	}

	return { greeting: true, rest: normalized.slice(match[0].length).trim() };
};

export const escapeHtml = (text: string): string => text
	.replace(/&/g, '&amp;')
	.replace(/</g, '&lt;')
	.replace(/>/g, '&gt;');
