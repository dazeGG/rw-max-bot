// Стеммер Портера (Snowball) для русского языка.
// Приводит слова к основе: «билеты», «билетов», «билет» → «билет»; «дальнего», «дальний» → «дальн».

const PERFECTIVE_GERUND = /((ив|ивши|ившись|ыв|ывши|ывшись)|((?<=[ая])(в|вши|вшись)))$/;
const REFLEXIVE = /(с[яь])$/;
const ADJECTIVE = /(ее|ие|ые|ое|ими|ыми|ей|ий|ый|ой|ем|им|ым|ом|его|ого|ему|ому|их|ых|ую|юю|ая|яя|ою|ею)$/;
const PARTICIPLE = /((ивш|ывш|ующ)|((?<=[ая])(ем|нн|вш|ющ|щ)))$/;
const VERB = /((ила|ыла|ена|ейте|уйте|ите|или|ыли|ей|уй|ил|ыл|им|ым|ен|ило|ыло|ено|ят|ует|уют|ит|ыт|ены|ить|ыть|ишь|ую|ю)|((?<=[ая])(ла|на|ете|йте|ли|й|л|ем|н|ло|но|ет|ют|ны|ть|ешь|нно)))$/;
const NOUN = /(а|ев|ов|ие|ье|е|иями|ями|ами|еи|ии|и|ией|ей|ой|ий|й|иям|ям|ием|ем|ам|ом|о|у|ах|иях|ях|ы|ь|ию|ью|ю|ия|ья|я)$/;
const RV = /^(.*?[аеиоуыэюя])(.*)$/;
const DERIVATIONAL = /.*[^аеиоуыэюя]+[аеиоуыэюя].*ость?$/;
const DER = /ость?$/;
const SUPERLATIVE = /(ейше|ейш)$/;
const I = /и$/;
const SOFT_SIGN = /ь$/;
const DOUBLE_N = /нн$/;

export const stem = (input: string): string => {
	const word = input.toLowerCase().replace(/ё/g, 'е');

	if (!/^[а-я]+$/.test(word)) {
		return word;
	}

	const match = RV.exec(word);

	if (!match || !match[2]) {
		return word;
	}

	const start = match[1];
	let rv = match[2];

	// Шаг 1
	let temp = rv.replace(PERFECTIVE_GERUND, '');

	if (temp === rv) {
		rv = rv.replace(REFLEXIVE, '');
		temp = rv.replace(ADJECTIVE, '');

		if (temp === rv) {
			temp = rv.replace(VERB, '');
			rv = temp === rv ? rv.replace(NOUN, '') : temp;
		} else {
			rv = temp.replace(PARTICIPLE, '');
		}
	} else {
		rv = temp;
	}

	// Шаг 2
	rv = rv.replace(I, '');

	// Шаг 3
	if (DERIVATIONAL.test(rv)) {
		rv = rv.replace(DER, '');
	}

	// Шаг 4
	temp = rv.replace(SOFT_SIGN, '');

	if (temp === rv) {
		rv = rv.replace(SUPERLATIVE, '').replace(DOUBLE_N, 'н');
	} else {
		rv = temp;
	}

	return start + rv;
};
