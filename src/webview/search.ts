import type { Node } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import type { EditorView } from "@milkdown/kit/prose/view";

const searchKey = new PluginKey("hanshi-search");

interface SearchMatch {
	from: number;
	to: number;
}

interface SearchState {
	query: string;
	caseSensitive: boolean;
	matches: SearchMatch[];
	activeIndex: number;
}

const emptyState: SearchState = {
	query: "",
	caseSensitive: false,
	matches: [],
	activeIndex: -1,
};

function findMatches(
	doc: Node,
	query: string,
	caseSensitive: boolean,
): SearchMatch[] {
	if (!query) return [];

	const matches: SearchMatch[] = [];
	const search = caseSensitive ? query : query.toLowerCase();

	doc.descendants((node, pos) => {
		if (!node.isText || !node.text) return;
		const text = caseSensitive ? node.text : node.text.toLowerCase();
		let index = 0;
		while (index < text.length) {
			const found = text.indexOf(search, index);
			if (found === -1) break;
			matches.push({ from: pos + found, to: pos + found + query.length });
			index = found + 1;
		}
	});

	return matches;
}

function createDecorations(doc: Node, state: SearchState): DecorationSet {
	if (!state.matches.length) return DecorationSet.empty;

	const decorations: Decoration[] = [];
	for (let i = 0; i < state.matches.length; i++) {
		const match = state.matches[i];
		const className =
			i === state.activeIndex
				? "hanshi-search-active"
				: "hanshi-search-match";
		decorations.push(
			Decoration.inline(match.from, match.to, { class: className }),
		);
	}
	return DecorationSet.create(doc, decorations);
}

export function createSearchPlugin(): {
	plugin: Plugin;
	controller: SearchController;
} {
	let currentState = { ...emptyState };
	let currentView: EditorView | undefined;
	let stateVersion = 0;
	let lastBuiltVersion = -1;

	const controller = new SearchController({
		getView: () => currentView,
		getState: () => currentState,
		setState: (next: SearchState) => {
			currentState = next;
			stateVersion++;
			if (currentView) {
				currentView.dispatch(
					currentView.state.tr.setMeta(searchKey, true),
				);
			}
		},
	});

	const plugin = new Plugin({
		key: searchKey,
		state: {
			init() {
				return DecorationSet.empty;
			},
			apply(tr, oldDecoSet, _oldEditorState, newEditorState) {
				const meta = tr.getMeta(searchKey) as true | undefined;

				if (!meta && tr.docChanged && currentState.query) {
					const matches = findMatches(
						newEditorState.doc,
						currentState.query,
						currentState.caseSensitive,
					);
					const activeIndex =
						matches.length > 0
							? Math.min(currentState.activeIndex, matches.length - 1)
							: -1;
					currentState = { ...currentState, matches, activeIndex };
					stateVersion++;
					controller.updateCountDisplay();
				}

				if (meta || lastBuiltVersion !== stateVersion) {
					lastBuiltVersion = stateVersion;
					return createDecorations(newEditorState.doc, currentState);
				}

				if (tr.docChanged) {
					return oldDecoSet.map(tr.mapping, tr.doc);
				}

				return oldDecoSet;
			},
		},
		props: {
			decorations(state) {
				return this.getState(state);
			},
		},
		view(view) {
			currentView = view;
			return {
				destroy() {
					currentView = undefined;
				},
			};
		},
	});

	return { plugin, controller };
}

interface SearchControllerDeps {
	getView: () => EditorView | undefined;
	getState: () => SearchState;
	setState: (next: SearchState) => void;
}

export class SearchController {
	private readonly bar: HTMLElement;
	private readonly input: HTMLInputElement;
	private readonly countLabel: HTMLSpanElement;
	private readonly caseSensitiveBtn: HTMLButtonElement;
	private scrollContainer: HTMLElement | null = null;
	private visible = false;

	constructor(private readonly deps: SearchControllerDeps) {
		this.bar = document.createElement("div");
		this.bar.className = "hanshi-search-bar";
		this.bar.dataset.visible = "false";

		this.input = document.createElement("input");
		this.input.type = "text";
		this.input.className = "hanshi-search-input";
		this.input.placeholder = "Find...";
		this.input.setAttribute("aria-label", "Search text");

		this.countLabel = document.createElement("span");
		this.countLabel.className = "hanshi-search-count";
		this.countLabel.textContent = "";

		this.caseSensitiveBtn = document.createElement("button");
		this.caseSensitiveBtn.type = "button";
		this.caseSensitiveBtn.className =
			"hanshi-search-btn hanshi-search-case-btn";
		this.caseSensitiveBtn.textContent = "Aa";
		this.caseSensitiveBtn.title = "Match Case";
		this.caseSensitiveBtn.setAttribute("aria-pressed", "false");

		const prevBtn = document.createElement("button");
		prevBtn.type = "button";
		prevBtn.className = "hanshi-search-btn";
		prevBtn.textContent = "\u2191";
		prevBtn.title = "Previous Match";

		const nextBtn = document.createElement("button");
		nextBtn.type = "button";
		nextBtn.className = "hanshi-search-btn";
		nextBtn.textContent = "\u2193";
		nextBtn.title = "Next Match";

		const closeBtn = document.createElement("button");
		closeBtn.type = "button";
		closeBtn.className = "hanshi-search-btn hanshi-search-close-btn";
		closeBtn.textContent = "\u00D7";
		closeBtn.title = "Close";

		this.bar.append(
			this.caseSensitiveBtn,
			this.input,
			this.countLabel,
			prevBtn,
			nextBtn,
			closeBtn,
		);

		this.input.addEventListener("input", () => this.onQueryChange());
		this.input.addEventListener("keydown", (e) => this.onInputKeydown(e));
		this.caseSensitiveBtn.addEventListener("click", () =>
			this.toggleCaseSensitive(),
		);
		prevBtn.addEventListener("click", () => this.findNext());
		nextBtn.addEventListener("click", () => this.findNext());
		closeBtn.addEventListener("click", () => this.close());
	}

	mount(container: HTMLElement): void {
		this.scrollContainer = container;
		container.prepend(this.bar);
	}

	open(): void {
		this.visible = true;
		this.bar.dataset.visible = "true";
		this.input.focus({ preventScroll: true });

		const view = this.deps.getView();
		if (view) {
			const { from, to } = view.state.selection;
			if (from !== to) {
				const text = view.state.doc.textBetween(from, to, " ");
				if (text.length > 0 && text.length < 200) {
					this.input.value = text;
					this.onQueryChange();
				}
			}
		}

		this.input.select();
	}

	close(): void {
		this.visible = false;
		this.bar.dataset.visible = "false";
		this.input.value = "";
		this.deps.setState({ ...emptyState });
		this.countLabel.textContent = "";
		this.deps.getView()?.focus();
	}

	isOpen(): boolean {
		return this.visible;
	}

	dispose(): void {
		this.bar.remove();
		this.scrollContainer = null;
	}

	updateCountDisplay(): void {
		const state = this.deps.getState();
		if (!state.query || state.matches.length === 0) {
			this.countLabel.textContent = state.query ? "No results" : "";
			return;
		}
		this.countLabel.textContent = `${state.activeIndex + 1}/${state.matches.length}`;
	}

	private onQueryChange(): void {
		const query = this.input.value;
		const state = this.deps.getState();
		const view = this.deps.getView();
		if (!view) return;

		const matches = findMatches(view.state.doc, query, state.caseSensitive);
		let activeIndex = -1;

		if (matches.length > 0) {
			const { from } = view.state.selection;
			activeIndex = 0;
			for (let i = 0; i < matches.length; i++) {
				if (matches[i].from >= from) {
					activeIndex = i;
					break;
				}
			}
		}

		this.deps.setState({
			query,
			caseSensitive: state.caseSensitive,
			matches,
			activeIndex,
		});
		this.updateCountDisplay();
		this.scrollToActive();
	}

	private toggleCaseSensitive(): void {
		const state = this.deps.getState();
		const next = !state.caseSensitive;
		this.caseSensitiveBtn.setAttribute("aria-pressed", String(next));
		this.caseSensitiveBtn.classList.toggle("active", next);

		const view = this.deps.getView();
		if (!view) return;

		const matches = findMatches(view.state.doc, state.query, next);
		const activeIndex = matches.length > 0 ? 0 : -1;
		this.deps.setState({
			query: state.query,
			caseSensitive: next,
			matches,
			activeIndex,
		});
		this.updateCountDisplay();
		this.scrollToActive();
	}

	private findNext(): void {
		const state = this.deps.getState();
		if (state.matches.length === 0) return;
		const nextIndex = (state.activeIndex + 1) % state.matches.length;
		this.deps.setState({ ...state, activeIndex: nextIndex });
		this.updateCountDisplay();
		this.scrollToActive();
	}

	private findPrev(): void {
		const state = this.deps.getState();
		if (state.matches.length === 0) return;
		const prevIndex =
			(state.activeIndex - 1 + state.matches.length) % state.matches.length;
		this.deps.setState({ ...state, activeIndex: prevIndex });
		this.updateCountDisplay();
		this.scrollToActive();
	}

	private scrollToActive(): void {
		const state = this.deps.getState();
		const view = this.deps.getView();
		if (!view || state.activeIndex < 0 || !state.matches.length) return;

		const match = state.matches[state.activeIndex];
		const coords = view.coordsAtPos(match.from);
		const dom = this.scrollContainer;
		if (dom && coords) {
			const rect = dom.getBoundingClientRect();
			const barHeight = this.bar.offsetHeight + 8;
			if (coords.top < rect.top + barHeight || coords.bottom > rect.bottom) {
				dom.scrollBy({
					top: coords.top - rect.top - barHeight - 40,
					behavior: "smooth",
				});
			}
		}
	}

	private onInputKeydown(event: KeyboardEvent): void {
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			this.close();
			return;
		}
		if (event.key === "Enter") {
			event.preventDefault();
			if (event.shiftKey) {
				this.findPrev();
			} else {
				this.findNext();
			}
			return;
		}
	}
}
