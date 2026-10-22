import { unlink } from 'fs/promises';

export const deleteFile = async (filePath: string) => {
	try {
		await unlink(filePath);
		console.log(`File ${filePath} deleted successfully`);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			console.log(`File ${filePath} does not exist`);
		} else {
			console.error(`Error during deleting file ${filePath}:`, error);
		}
		return false;
	}
};
