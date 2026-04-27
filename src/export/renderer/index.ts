async function renderMermaidBlocks(): Promise<void> {
	const blocks = Array.from(
		document.querySelectorAll<HTMLElement>(
			"pre > code.language-mermaid, pre > code.language-mmd",
		),
	);

	if (blocks.length === 0) return;

	const mermaid = (await import("mermaid")).default;

	mermaid.initialize({
		startOnLoad: false,
		securityLevel: "strict",
		theme: "neutral",
		flowchart: { htmlLabels: false },
	});

	let counter = 0;

	await Promise.all(
		blocks.map(async (block) => {
			const source = block.textContent ?? "";
			const pre = block.parentElement;
			if (!pre) return;

			try {
				const id = `hanshi-print-mermaid-${counter++}-${Date.now().toString(36)}`;
				const { svg } = await mermaid.render(id, source.trim());
				const wrapper = document.createElement("div");
				wrapper.className = "hanshi-print-mermaid";
				wrapper.innerHTML = svg;
				pre.replaceWith(wrapper);
			} catch (error) {
				const fallback = document.createElement("div");
				fallback.className = "hanshi-print-mermaid is-error";
				fallback.textContent =
					error instanceof Error ? error.message : String(error);
				pre.replaceWith(fallback);
			}
		}),
	);
}

const ready = (async () => {
	try {
		await renderMermaidBlocks();
	} catch {
		// Continue even if Mermaid rendering fails entirely.
	}
	await new Promise((resolve) =>
		requestAnimationFrame(() => resolve(null)),
	);
})();

const button = document.getElementById("hanshi-print-button");
button?.addEventListener("click", () => window.print());
void ready.then(() => window.print());
