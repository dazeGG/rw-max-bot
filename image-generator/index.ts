import fs from 'fs';

import { generateImages } from './generate-images';
import { generateTransferSchedule } from './generate-transfer-schedule';

console.log('File generation started');

fs.mkdirSync('./media/generated', { recursive: true });

try {
	await generateImages();
	console.log('Image generation finished');
	await generateTransferSchedule();
} catch (error) {
	console.error('Images could not be generated', error);
}
