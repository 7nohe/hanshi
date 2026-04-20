export interface OgpMetadata {
	title?: string;
	description?: string;
	imageUrl?: string;
	siteName?: string;
}

const MAX_BODY_BYTES = 65_536;
const FETCH_TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 3;

const metaPattern =
	/<meta\s+(?:[^>]*?\s+)?(?:property|name)\s*=\s*["']([^"']+)["'][^>]*?\s+content\s*=\s*["']([^"']*?)["']|<meta\s+(?:[^>]*?\s+)?content\s*=\s*["']([^"']*?)["'][^>]*?\s+(?:property|name)\s*=\s*["']([^"']+)["']/gi;

const titlePattern = /<title[^>]*>([^<]*)<\/title>/i;

export async function fetchOgpMetadata(url: string): Promise<OgpMetadata> {
	const parsed = new URL(url);
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error(`Unsupported protocol: ${parsed.protocol}`);
	}

	let currentUrl = url;
	let html: string | undefined;

	for (let i = 0; i <= MAX_REDIRECTS; i++) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

		try {
			const response = await fetch(currentUrl, {
				signal: controller.signal,
				redirect: "manual",
				headers: {
					Accept: "text/html",
					"User-Agent": "HanshiLinkPreview/1.0",
				},
			});

			if (response.status >= 300 && response.status < 400) {
				const location = response.headers.get("location");
				if (!location) break;
				currentUrl = new URL(location, currentUrl).href;
				continue;
			}

			const contentType = response.headers.get("content-type") ?? "";
			if (!contentType.includes("text/html") && !contentType.includes("text/xhtml")) {
				return {};
			}

			const reader = response.body?.getReader();
			if (!reader) return {};

			const chunks: Uint8Array[] = [];
			let totalBytes = 0;

			while (totalBytes < MAX_BODY_BYTES) {
				const { done, value } = await reader.read();
				if (done || !value) break;
				chunks.push(value);
				totalBytes += value.byteLength;
			}

			reader.cancel().catch(() => {});
			html = new TextDecoder().decode(concatUint8Arrays(chunks)).slice(0, MAX_BODY_BYTES);
			break;
		} finally {
			clearTimeout(timer);
		}
	}

	if (!html) return {};

	return parseOgpFromHtml(html);
}

function parseOgpFromHtml(html: string): OgpMetadata {
	const meta: Record<string, string> = {};

	for (const match of html.matchAll(metaPattern)) {
		const key = (match[1] || match[4])?.toLowerCase();
		const value = match[2] ?? match[3];
		if (key && value) {
			meta[key] = decodeHtmlEntities(value);
		}
	}

	const title = meta["og:title"] || meta["twitter:title"] || extractTitle(html);
	const description = meta["og:description"] || meta["twitter:description"] || meta.description;
	const imageUrl = meta["og:image"] || meta["twitter:image"];
	const siteName = meta["og:site_name"];

	if (!title && !description && !imageUrl) return {};

	return {
		...(title && { title }),
		...(description && { description }),
		...(imageUrl && { imageUrl }),
		...(siteName && { siteName }),
	};
}

function extractTitle(html: string): string | undefined {
	const match = html.match(titlePattern);
	return match?.[1] ? decodeHtmlEntities(match[1].trim()) : undefined;
}

function decodeHtmlEntities(text: string): string {
	return text
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#039;/g, "'")
		.replace(/&#x27;/g, "'")
		.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
	const totalLength = arrays.reduce((sum, a) => sum + a.byteLength, 0);
	const result = new Uint8Array(totalLength);
	let offset = 0;
	for (const arr of arrays) {
		result.set(arr, offset);
		offset += arr.byteLength;
	}
	return result;
}
