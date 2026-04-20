import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import type {
	FetchLinkPreviewResultMessage,
	WebviewToHostMessage,
} from "../../shared/protocol";

interface OgpResult {
	title?: string;
	description?: string;
	imageUrl?: string;
	siteName?: string;
	error?: boolean;
}

interface LinkPreviewOptions {
	postMessage: (msg: WebviewToHostMessage) => void;
	container: HTMLElement;
}

const HOVER_DEBOUNCE_MS = 300;
const HTTP_URL_PATTERN = /^https?:\/\//;
const linkPreviewKey = new PluginKey("link-preview");

let requestSequence = 0;

export function createLinkPreviewPlugin(options: LinkPreviewOptions): {
	plugin: Plugin;
	settleLinkPreview: (msg: FetchLinkPreviewResultMessage) => void;
} {
	const cache = new Map<string, OgpResult>();
	const pendingCallbacks = new Map<string, (result: OgpResult) => void>();
	const cardDomCache = new Map<string, HTMLElement>();

	let currentView: EditorView | undefined;
	let tooltip: HTMLElement | undefined;
	let hoverTimer: number | undefined;
	let activeUrl: string | undefined;
	let mouseOnTooltip = false;
	let mouseOnLink = false;

	// ── Shared fetch ────────────────────────────────────────────

	function fetchPreview(url: string, callback: (result: OgpResult) => void): void {
		const cached = cache.get(url);
		if (cached) {
			callback(cached);
			return;
		}

		requestSequence += 1;
		const requestId = `link-preview-${requestSequence}`;
		pendingCallbacks.set(requestId, (result) => {
			cache.set(url, result);
			callback(result);
		});
		options.postMessage({
			type: "fetchLinkPreviewRequest",
			requestId,
			url,
		});
	}

	// ── Shared card rendering ───────────────────────────────────

	function renderCardContent(el: HTMLElement, data: OgpResult, useThumbWrapper = false): void {
		el.replaceChildren();

		if (data.imageUrl) {
			const img = document.createElement("img");
			img.className = "hanshi-link-preview-image";
			img.src = data.imageUrl;
			img.alt = "";
			if (useThumbWrapper) {
				const thumb = document.createElement("div");
				thumb.className = "hanshi-link-card-thumb";
				thumb.appendChild(img);
				img.onerror = () => thumb.remove();
				el.appendChild(thumb);
			} else {
				img.onerror = () => img.remove();
				el.appendChild(img);
			}
		}

		const body = document.createElement("div");
		body.className = "hanshi-link-preview-body";

		if (data.title) {
			const title = document.createElement("div");
			title.className = "hanshi-link-preview-title";
			title.textContent = data.title;
			body.appendChild(title);
		}

		if (data.description) {
			const desc = document.createElement("div");
			desc.className = "hanshi-link-preview-description";
			desc.textContent = data.description;
			body.appendChild(desc);
		}

		if (data.siteName) {
			const site = document.createElement("div");
			site.className = "hanshi-link-preview-site";
			site.textContent = data.siteName;
			body.appendChild(site);
		}

		el.appendChild(body);
	}

	// ── Hover tooltip ───────────────────────────────────────────

	function getOrCreateTooltip(): HTMLElement {
		if (tooltip) return tooltip;
		tooltip = document.createElement("div");
		tooltip.className = "hanshi-link-preview";
		tooltip.addEventListener("mouseenter", () => {
			mouseOnTooltip = true;
		});
		tooltip.addEventListener("mouseleave", () => {
			mouseOnTooltip = false;
			scheduleHide();
		});
		options.container.appendChild(tooltip);
		return tooltip;
	}

	function showTooltip(url: string, anchor: HTMLElement): void {
		fetchPreview(url, (result) => {
			if (activeUrl !== url) return;
			if (result.error || (!result.title && !result.description)) {
				hideTooltip();
				return;
			}
			const el = getOrCreateTooltip();
			renderCardContent(el, result);
			positionTooltip(el, anchor);
			el.dataset.visible = "true";
		});
	}

	function positionTooltip(el: HTMLElement, anchor: HTMLElement): void {
		const containerRect = options.container.getBoundingClientRect();
		const anchorRect = anchor.getBoundingClientRect();
		const left = Math.max(
			0,
			Math.min(anchorRect.left - containerRect.left, containerRect.width - 360),
		);
		const top =
			anchorRect.bottom - containerRect.top + options.container.scrollTop + 4;
		el.style.position = "absolute";
		el.style.left = `${left}px`;
		el.style.top = `${top}px`;
	}

	function hideTooltip(): void {
		if (tooltip) tooltip.dataset.visible = "false";
		activeUrl = undefined;
	}

	function scheduleHide(): void {
		setTimeout(() => {
			if (!mouseOnTooltip && !mouseOnLink) hideTooltip();
		}, 100);
	}

	function findLinkAnchor(target: EventTarget | null): HTMLAnchorElement | null {
		if (!(target instanceof HTMLElement)) return null;
		const anchor = target.closest("a[href]");
		if (!(anchor instanceof HTMLAnchorElement)) return null;
		const href = anchor.getAttribute("href") ?? "";
		if (!HTTP_URL_PATTERN.test(href)) return null;
		return anchor;
	}

	function handleMouseOver(_view: EditorView, event: MouseEvent): boolean {
		const anchor = findLinkAnchor(event.target);
		if (!anchor) return false;
		// Don't show tooltip for links that already have an inline card
		if (anchor.closest(".hanshi-link-card-wrapper")) return false;

		const href = anchor.getAttribute("href") ?? "";
		mouseOnLink = true;
		if (href === activeUrl) return false;

		window.clearTimeout(hoverTimer);
		hoverTimer = window.setTimeout(() => {
			activeUrl = href;
			showTooltip(href, anchor);
		}, HOVER_DEBOUNCE_MS);
		return false;
	}

	function handleMouseOut(_view: EditorView, event: MouseEvent): boolean {
		const anchor = findLinkAnchor(event.target);
		if (!anchor) return false;
		mouseOnLink = false;
		window.clearTimeout(hoverTimer);
		scheduleHide();
		return false;
	}

	// ── Inline card decorations ─────────────────────────────────

	function isStandaloneLink(
		node: import("@milkdown/kit/prose/model").Node,
	): string | undefined {
		if (node.type.name !== "paragraph" || node.childCount !== 1) return undefined;
		const child = node.firstChild;
		if (!child?.isText || child.marks.length !== 1) return undefined;
		const linkMark = child.marks.find((m) => m.type.name === "link");
		if (!linkMark) return undefined;
		const href = linkMark.attrs.href as string | undefined;
		if (!href || !HTTP_URL_PATTERN.test(href)) return undefined;
		if (child.textContent !== href) return undefined;
		return href;
	}

	function createCardDom(url: string): HTMLElement {
		const existing = cardDomCache.get(url);
		if (existing) return existing;

		const wrapper = document.createElement("div");
		wrapper.className = "hanshi-link-card-wrapper";
		wrapper.contentEditable = "false";

		const card = document.createElement("a");
		card.className = "hanshi-link-card";
		card.href = url;
		card.rel = "noopener noreferrer";
		card.dataset.loading = "true";
		card.addEventListener("click", (e) => {
			e.preventDefault();
		});

		const loading = document.createElement("div");
		loading.className = "hanshi-link-card-loading";
		loading.textContent = "Loading preview\u2026";
		card.appendChild(loading);
		wrapper.appendChild(card);
		cardDomCache.set(url, wrapper);

		fetchPreview(url, (result) => {
			if (result.error || (!result.title && !result.description)) {
				cardDomCache.delete(url);
				// Trigger redecoration to remove the loading card
				if (currentView) {
					currentView.dispatch(
						currentView.state.tr.setMeta(linkPreviewKey, "refresh"),
					);
				}
				return;
			}
			delete card.dataset.loading;
			renderCardContent(card, result, true);
		});

		return wrapper;
	}

	function buildDecorations(view: EditorView): DecorationSet {
		const decorations: Decoration[] = [];
		const activeUrls = new Set<string>();

		view.state.doc.descendants((node, pos) => {
			const url = isStandaloneLink(node);
			if (!url) return;

			// Skip if fetch failed (no data and not loading)
			const cached = cache.get(url);
			if (cached?.error) return;
			if (cached && !cached.title && !cached.description) return;

			activeUrls.add(url);
			const endPos = pos + node.nodeSize;
			decorations.push(
				Decoration.widget(endPos, () => createCardDom(url), {
					side: 1,
					key: `link-card-${url}`,
				}),
			);
		});

		// Clean up stale DOM cache entries
		for (const url of cardDomCache.keys()) {
			if (!activeUrls.has(url)) cardDomCache.delete(url);
		}

		return DecorationSet.create(view.state.doc, decorations);
	}

	// ── Plugin ──────────────────────────────────────────────────

	const plugin = new Plugin({
		key: linkPreviewKey,
		state: {
			init() {
				return DecorationSet.empty;
			},
			apply(tr, decos, _oldState, _newState) {
				if (tr.docChanged || tr.getMeta(linkPreviewKey) === "refresh") {
					return currentView ? buildDecorations(currentView) : DecorationSet.empty;
				}
				return decos.map(tr.mapping, tr.doc);
			},
		},
		props: {
			decorations(state) {
				return linkPreviewKey.getState(state) ?? DecorationSet.empty;
			},
			handleDOMEvents: {
				mouseover: handleMouseOver,
				mouseout: handleMouseOut,
			},
		},
		view(view) {
			currentView = view;
			// Build initial decorations
			requestAnimationFrame(() => {
				if (currentView === view) {
					view.dispatch(view.state.tr.setMeta(linkPreviewKey, "refresh"));
				}
			});

			return {
				update(view) {
					currentView = view;
				},
				destroy() {
					currentView = undefined;
					window.clearTimeout(hoverTimer);
					tooltip?.remove();
					tooltip = undefined;
					cardDomCache.clear();
				},
			};
		},
	});

	function settleLinkPreview(msg: FetchLinkPreviewResultMessage): void {
		const callback = pendingCallbacks.get(msg.requestId);
		if (!callback) return;
		pendingCallbacks.delete(msg.requestId);

		if (msg.error) {
			callback({ error: true });
			return;
		}

		callback({
			title: msg.title,
			description: msg.description,
			imageUrl: msg.imageUrl,
			siteName: msg.siteName,
		});
	}

	return { plugin, settleLinkPreview };
}
