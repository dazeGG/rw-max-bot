import { mergeImages } from './merge-images';

import { transfer } from './assets/script';

export const generateTransferSchedule = async () => {
	const image1 = `./media/generated/${transfer.schedule584.file}`;
	const image2 = `./media/generated/${transfer.schedule583.file}`;
	const outputFile = './media/generated/transfer-schedule.jpg';

	await mergeImages(image1, image2, outputFile, 'vertical');
};
