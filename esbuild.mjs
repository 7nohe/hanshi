import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const extensionConfig = {
	entryPoints: ["src/extension.ts"],
	bundle: true,
	format: "cjs",
	platform: "node",
	target: "node18",
	outfile: "dist/extension.js",
	external: ["vscode"],
	sourcemap: true,
	logLevel: "info",
};

/** @type {import('esbuild').BuildOptions} */
const webviewConfig = {
	entryPoints: ["src/webview/index.ts"],
	bundle: true,
	format: "esm",
	platform: "browser",
	target: "chrome114",
	outdir: "dist/webview",
	entryNames: "index",
	chunkNames: "chunks/[name]-[hash]",
	assetNames: "assets/[name]-[hash]",
	sourcemap: true,
	minify: !watch,
	splitting: true,
	logLevel: "info",
	loader: {
		".css": "css",
		".woff2": "file",
		".woff": "file",
		".ttf": "file",
	},
};

/** @type {import('esbuild').BuildOptions} */
const exportRendererConfig = {
	entryPoints: ["src/export/renderer/index.ts"],
	bundle: true,
	format: "iife",
	platform: "browser",
	target: "chrome114",
	outfile: "dist/export/index.js",
	sourcemap: true,
	minify: !watch,
	logLevel: "info",
};

async function build() {
	if (watch) {
		const extensionContext = await esbuild.context(extensionConfig);
		const webviewContext = await esbuild.context(webviewConfig);
		const exportContext = await esbuild.context(exportRendererConfig);
		await Promise.all([
			extensionContext.watch(),
			webviewContext.watch(),
			exportContext.watch(),
		]);
		return;
	}

	await Promise.all([
		esbuild.build(extensionConfig),
		esbuild.build(webviewConfig),
		esbuild.build(exportRendererConfig),
	]);
}

build().catch((error) => {
	console.error(error);
	process.exit(1);
});
