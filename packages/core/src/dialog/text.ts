// Greeting recognition is protocol-only; the remaining semantic question stays intact.
// Use an explicit boundary because JS \b does not recognize Cyrillic words.
const GREETING = /^(?:здравствуйте|здравствуй|здрасте|привет|приветствую|добрый\s+(?:день|вечер)|доброе\s+утро|доброго\s+(?:дня|времени\s+суток)|доброй\s+ночи|hello|hi)(?=$|[\s,!.?:;…—–-])[\s,!.?:;…—–-]*/iu;

export const normalize = (text: string): string => text
	.toLowerCase()
	.replace(/ё/g, 'е')
	.replace(/<[^>]*>/g, ' ')
	.replace(/[^a-zа-я0-9\s-]/g, ' ')
	.replace(/-/g, ' ')
	.replace(/\s+/g, ' ')
	.trim();

// Без букв и цифр (эмодзи, пунктуация) сравнивать с контентом нечего
export const hasWords = (text: string): boolean => /[\p{L}\p{N}]/u.test(text);

export const stripGreetingRaw = (text: string): { greeting: boolean; rest: string } => {
	const raw = text.trim();
	const match = GREETING.exec(raw);

	if (!match) {
		return { greeting: false, rest: raw };
	}

	return { greeting: true, rest: raw.slice(match[0].length) };
};

export const stripGreeting = (text: string): { greeting: boolean; rest: string } => {
	const { greeting, rest } = stripGreetingRaw(text);
	return { greeting, rest: normalize(rest) };
};

export const escapeHtml = (text: string): string => text
	.replace(/&/g, '&amp;')
	.replace(/</g, '&lt;')
	.replace(/>/g, '&gt;');
