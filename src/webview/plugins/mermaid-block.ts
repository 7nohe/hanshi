let mermaidModule: typeof import('mermaid') | undefined;

async function loadMermaid(): Promise<typeof import('mermaid')> {
  if (!mermaidModule) {
    mermaidModule = await import('mermaid');
    mermaidModule.default.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'neutral',
    });
  }

  return mermaidModule;
}

export async function enhanceMermaidBlocks(root: HTMLElement): Promise<void> {
  const blocks = root.querySelectorAll<HTMLElement>('pre code.language-mermaid, pre code.lang-mermaid');

  if (!blocks.length) {
    return;
  }

  const mermaid = await loadMermaid();

  await Promise.all(
    Array.from(blocks).map(async (code, index) => {
      const pre = code.closest('pre');

      if (!pre || pre.dataset.hanshiMermaid === 'done') {
        return;
      }

      pre.dataset.hanshiMermaid = 'done';
      const container = document.createElement('div');
      container.className = 'hanshi-mermaid-preview';

      try {
        const renderResult = await mermaid.default.render(`hanshi-mermaid-${index}-${Date.now()}`, code.textContent ?? '');
        container.innerHTML = renderResult.svg;
      } catch (error) {
        container.textContent = error instanceof Error ? error.message : String(error);
        container.classList.add('is-error');
      }

      pre.insertAdjacentElement('afterend', container);
    }),
  );
}
