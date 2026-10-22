import fs from 'fs';
import path from 'path';

import nodeHtmlToImage from 'node-html-to-image';

import * as images from './assets/script';
import type { TableData } from './types';

const loadLogo = (): string => {
	const logoBuffer = fs.readFileSync(path.join('./media/logo.png'));
	return `data:image/png;base64,${logoBuffer.toString('base64')}`;
};

const generateImage = async (tableData: TableData, logoSrc: string) => {
	let html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,100..900;1,100..900&family=Open+Sans:ital,wght@0,300..800;1,300..800&display=swap" rel="stylesheet">
  <style>*,::after,::before,a{color:inherit;text-decoration:none}a,button{cursor:pointer}*,::after,::before{margin:0;padding:0;border:0;box-sizing:border-box;font:inherit;vertical-align:baseline;list-style:none;outline:0;background:0 0}article,aside,details,figcaption,figure,footer,header,hgroup,menu,nav,section{display:block}body{line-height:1}table{border-collapse:collapse;border-spacing:0}button,input,select,textarea{appearance:none;border-radius:0;background:0 0}input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}ol,ul{list-style:none}blockquote,q{quotes:none}blockquote:after,blockquote:before,q:after,q:before{content:'';content:none}</style>
  <style>@charset "UTF-8";.table__description{color:#1a3a8f}.table__wrapper,body{position:relative}.table__row:last-child,.table__row:not(:last-child){border-bottom:var(--border)}:root{--border-width:0.125rem;--border-color:#c7d9f5;--border-color-header:#7aa2f7;--border:var(--border-width) solid var(--border-color)}*{font-family:"Open Sans",sans-serif}h1,h2{font-family:Montserrat,sans-serif;font-weight:600;color:#1a3a8f}h1{font-size:2rem}h2{font-size:1.5rem}body{width:{{width}};}.table{background-color:#e1edfd;padding:1rem;font-size:1rem;display:flex;flex-direction:column;gap:1rem}.table__logo{position:absolute;width:100%;height:100%;max-width:90%;max-height:90%;object-fit:contain;top:50%;left:50%;transform:translate(-50%,-50%);aspect-ratio:1/1;z-index:1;filter:blur({{logoBlur}});opacity:.25}.table__body{color:#2c3e50}.table__row{display:grid;grid-template-columns:{{grid}};gap:1rem;padding-inline:0.75rem;border-inline:var(--border);z-index:0}.table__row:first-child{border-top:var(--border);border-radius:.5rem .5rem 0 0}.table__row:last-child{border-radius:0 0 .5rem .5rem}.table__row:nth-child(odd):not(:first-child){background:#f0f6ff}.table__item{flex:1;padding-block:0.75rem;z-index:2}.table__head{background-color:#a0c4ff;color:#1a3a8f;border-color:var(--border-color-header)!important}.table__head .table__item{display:flex;align-items:center;justify-content:space-between;padding-block:0.5rem;height:2.5rem;font-weight:700}.table__head .table__item:not(:last-child)::after{display:block;content:"";width:var(--border-width);height:100%;background-color:var(--border-color-header)}.grain-overlay{position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:100;background-image:url('data:image/svg+xml;utf8,<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><filter id="noise"><feTurbulence type="fractalNoise" baseFrequency="3" numOctaves="3" stitchTiles="stitch"/></filter><rect width="100%" height="100%" filter="url(%23noise)" opacity="0.25"/></svg>')}</style>
</head>
<body>
  <div class="grain-overlay"></div>
  <div class="table">
    <h1 class="table__title">${tableData.title}</h1>
    {{ description }}

    <div class="table__wrapper">
      <img class="table__logo" src="{{logoSrc}}" alt="" />
      <div class="table__body">`;

	const [header, ...rows] = tableData.data;

	html += `
        <div class="table__row table__head">`;
	for (const item of header) {
		html += `
          <div class="table__item">${item}</div>`;
	}
	html += `
        </div>`;

	for (const row of rows) {
		html += `
        <div class="table__row">`;
		for (const item of row) {
			html += `
          <div class="table__item">${item}</div>`;
		}
		html += `
        </div>`;
	}

	html += `
      </div>
    </div>
  </div>
</body>
</html>`;

	html = html.replace(
		'{{ description }}',
		tableData.description
			? `<p class="table__description">${tableData.description}</p>`
			: '',
	);

	try {
		await nodeHtmlToImage({
			html,
			output: `./media/generated/${tableData.file}`,
			type: 'jpeg',
			content: {
				logoSrc,
				logoBlur: tableData.logoBlur ?? '.75rem',
				width: tableData.width,
				grid: tableData.grid,
			},
		});
		console.log(`Image ${tableData.file} generated successfully`);
	} catch (error) {
		console.error(`Error during ${tableData.file} image generation`, error);
		throw error;
	}
};

type Image = keyof typeof images;
type Key = keyof typeof images[Image];

export const generateImages = async () => {
	const logoSrc = loadLogo();
	const tasks = Object.keys(images).flatMap(image =>
		Object.keys(images[image as Image]).map(key =>
			generateImage(images[image as Image][key as Key], logoSrc),
		),
	);
	await Promise.all(tasks);
};
