export type TableData<T = string[]> = {
	file: string;
	width: string;
	grid: string;
	title: string;
	description?: string;
	logoBlur?: string;
	data: T[];
};
