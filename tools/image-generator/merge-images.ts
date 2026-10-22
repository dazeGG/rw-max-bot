import sharp from 'sharp';

export const mergeImages = async (image1Path: string, image2Path: string, outputPath: string, direction: 'vertical' | 'horizontal' = 'horizontal') => {
	const [{ data: image1, info: info1 }, { data: image2, info: info2 }] = await Promise.all([
		sharp(image1Path).toBuffer({ resolveWithObject: true }),
		sharp(image2Path).toBuffer({ resolveWithObject: true }),
	]);

	const width = direction === 'horizontal'
		? info1.width + info2.width
		: Math.max(info1.width, info2.width);
	const height = direction === 'vertical'
		? info1.height + info2.height
		: Math.max(info1.height, info2.height);

	await sharp({
		create: {
			width,
			height,
			channels: 4,
			background: { r: 255, g: 255, b: 255, alpha: 0 },
		},
	})
		.composite([
			{ input: image1, left: 0, top: 0 },
			{
				input: image2,
				left: direction === 'horizontal' ? info1.width : 0,
				top: direction === 'vertical' ? info1.height : 0,
			},
		])
		.toFile(outputPath);

	console.log('Images merged successfully:', outputPath);
	return outputPath;
};
