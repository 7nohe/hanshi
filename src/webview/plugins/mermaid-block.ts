let mermaidModule: typeof import("mermaid") | undefined;
let nextRenderId = 0;
let delegationInstalled = false;

const MERMAID_CONTENT_RE =
	/^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|quadrantChart|requirementDiagram|block-beta|architecture)\b/m;

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const ZOOM_STEP = 0.15;

async function loadMermaid(): Promise<typeof import("mermaid")> {
	if (!mermaidModule) {
		mermaidModule = await import("mermaid");
		const textColor = getThemeToken("--hanshi-fg", "#d4d4d4");
		const backgroundColor = getThemeToken("--hanshi-bg", "#1e1e1e");

		mermaidModule.default.initialize({
			startOnLoad: false,
			securityLevel: "strict",
			theme: isDarkMode() ? "dark" : "neutral",
			themeVariables: {
				primaryTextColor: textColor,
				secondaryTextColor: textColor,
				tertiaryTextColor: textColor,
				textColor,
				lineColor: textColor,
				mainBkg: backgroundColor,
				nodeTextColor: textColor,
			},
			flowchart: {
				htmlLabels: false,
			},
		});
	}

	return mermaidModule;
}

export function renderMermaidPreview(
	language: string,
	content: string,
	applyPreview: (value: null | string | HTMLElement) => void,
): null | string | undefined {
	if (!isMermaidBlock(language, content)) {
		return null;
	}

	installDelegation();

	const source = content.trim();

	if (!source) {
		return '<div class="hanshi-mermaid-preview is-empty">Empty mermaid block</div>';
	}

	void loadMermaid()
		.then((mermaid) =>
			mermaid.default.render(`hanshi-mermaid-${nextRenderId++}`, source),
		)
		.then(({ svg }) => {
			const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
			applyPreview(
				`<div class="hanshi-mermaid-preview">` +
					`<div class="hanshi-mermaid-toolbar">` +
					`<button class="hanshi-mermaid-btn" data-zoom="-1" title="Zoom out">\u2212</button>` +
					`<span class="hanshi-mermaid-zoom-label">100%</span>` +
					`<button class="hanshi-mermaid-btn" data-zoom="1" title="Zoom in">+</button>` +
					`<button class="hanshi-mermaid-btn" data-zoom="0" title="Reset zoom">Reset</button>` +
					`<span style="flex:1"></span>` +
					`<button class="hanshi-mermaid-btn hanshi-mermaid-fullscreen-btn" data-fullscreen title="Fullscreen">&#x26F6;</button>` +
					`</div>` +
					`<div class="hanshi-mermaid-viewport" data-scale="1" data-pan-x="0" data-pan-y="0">` +
					`<img src="${dataUrl}" alt="Mermaid diagram preview" />` +
					`</div>` +
					`</div>`,
			);
		})
		.catch((error: unknown) => {
			const message = error instanceof Error ? error.message : String(error);
			applyPreview(
				`<div class="hanshi-mermaid-preview is-error">${escapeHtml(message)}</div>`,
			);
		});
}

function installDelegation(): void {
	if (delegationInstalled) return;
	delegationInstalled = true;

	document.addEventListener("click", (e) => {
		const fsBtn = (e.target as HTMLElement).closest<HTMLElement>(
			".hanshi-mermaid-btn[data-fullscreen]",
		);
		if (fsBtn) {
			e.stopPropagation();
			const preview = fsBtn.closest<HTMLElement>(".hanshi-mermaid-preview");
			if (preview) toggleFullscreen(preview);
			return;
		}

		const btn = (e.target as HTMLElement).closest<HTMLElement>(
			".hanshi-mermaid-btn[data-zoom]",
		);
		if (!btn) return;

		const viewport = btn
			.closest(".hanshi-mermaid-preview")
			?.querySelector<HTMLElement>(".hanshi-mermaid-viewport");
		if (!viewport) return;

		e.stopPropagation();
		const direction = Number(btn.dataset.zoom);
		if (direction === 0) {
			setViewportTransform(viewport, 1, 0, 0);
		} else {
			const current = Number(viewport.dataset.scale) || 1;
			setViewportTransform(
				viewport,
				clampScale(current + direction * ZOOM_STEP),
			);
		}
	});

	document.addEventListener(
		"wheel",
		(e) => {
			const viewport = (e.target as HTMLElement).closest<HTMLElement>(
				".hanshi-mermaid-viewport",
			);
			if (!viewport) return;

			e.preventDefault();
			const current = Number(viewport.dataset.scale) || 1;
			const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
			setViewportTransform(viewport, clampScale(current + delta));
		},
		{ passive: false },
	);

	let dragViewport: HTMLElement | null = null;
	let lastX = 0;
	let lastY = 0;

	document.addEventListener("pointerdown", (e) => {
		const viewport = (e.target as HTMLElement).closest<HTMLElement>(
			".hanshi-mermaid-viewport",
		);
		if (!viewport || (e as PointerEvent).button !== 0) return;

		e.stopPropagation();
		dragViewport = viewport;
		lastX = e.clientX;
		lastY = e.clientY;
		viewport.setPointerCapture((e as PointerEvent).pointerId);
	});

	document.addEventListener("pointermove", (e) => {
		if (!dragViewport) return;

		const panX = (Number(dragViewport.dataset.panX) || 0) + (e.clientX - lastX);
		const panY = (Number(dragViewport.dataset.panY) || 0) + (e.clientY - lastY);
		lastX = e.clientX;
		lastY = e.clientY;
		setViewportTransform(dragViewport, undefined, panX, panY);
	});

	document.addEventListener("pointerup", () => {
		dragViewport = null;
	});
	document.addEventListener("pointercancel", () => {
		dragViewport = null;
	});

	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape") {
			const active = document.querySelector<HTMLElement>(
				".hanshi-mermaid-preview.is-fullscreen",
			);
			if (active) {
				e.stopPropagation();
				toggleFullscreen(active);
			}
		}
	});
}

function toggleFullscreen(preview: HTMLElement): void {
	const isFs = preview.classList.toggle("is-fullscreen");
	const btn = preview.querySelector<HTMLElement>(".hanshi-mermaid-fullscreen-btn");
	if (btn) {
		btn.innerHTML = isFs ? "&#x2716;" : "&#x26F6;";
		btn.title = isFs ? "Exit fullscreen" : "Fullscreen";
	}
}

function clampScale(value: number): number {
	return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

function setViewportTransform(
	viewport: HTMLElement,
	scale?: number,
	panX?: number,
	panY?: number,
): void {
	const s = scale ?? (Number(viewport.dataset.scale) || 1);
	const x = panX ?? (Number(viewport.dataset.panX) || 0);
	const y = panY ?? (Number(viewport.dataset.panY) || 0);

	viewport.dataset.scale = String(s);
	viewport.dataset.panX = String(x);
	viewport.dataset.panY = String(y);

	const img = viewport.querySelector<HTMLElement>("img");
	if (img) {
		img.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
	}

	const label = viewport
		.closest(".hanshi-mermaid-preview")
		?.querySelector<HTMLElement>(".hanshi-mermaid-zoom-label");
	if (label) {
		label.textContent = `${Math.round(s * 100)}%`;
	}
}

function isMermaidBlock(language: string, content: string): boolean {
	const lang = language.trim().toLowerCase();

	if (lang === "mermaid" || lang === "mmd") {
		return true;
	}

	if (!lang) {
		return MERMAID_CONTENT_RE.test(content.trim());
	}

	return false;
}

function isDarkMode(): boolean {
	return (
		document.body.classList.contains("vscode-dark") ||
		document.body.classList.contains("vscode-high-contrast") ||
		window.matchMedia("(prefers-color-scheme: dark)").matches
	);
}

function getThemeToken(name: string, fallback: string): string {
	return (
		getComputedStyle(document.documentElement).getPropertyValue(name).trim() ||
		fallback
	);
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}
