const headingPattern = /^(#{1,6})\s+(.+)$/;

export interface HeadingItem {
	name: string;
	level: number;
	/** 0-based sequential index across all headings in the document */
	index: number;
	children: HeadingItem[];
}

export function parseHeadings(text: string): HeadingItem[] {
	const lines = text.split("\n");
	const roots: HeadingItem[] = [];
	const stack: HeadingItem[] = [];
	let headingIndex = 0;

	// Skip frontmatter
	let startIndex = 0;
	if (lines[0]?.trim() === "---") {
		for (let i = 1; i < lines.length; i++) {
			if (lines[i].trim() === "---") {
				startIndex = i + 1;
				break;
			}
		}
	}

	for (let i = startIndex; i < lines.length; i++) {
		const match = headingPattern.exec(lines[i]);
		if (!match) continue;

		const level = match[1].length;
		const name = match[2].trim();
		const heading: HeadingItem = {
			name,
			level,
			index: headingIndex++,
			children: [],
		};

		while (stack.length > 0 && stack[stack.length - 1].level >= level) {
			stack.pop();
		}

		if (stack.length > 0) {
			stack[stack.length - 1].children.push(heading);
		} else {
			roots.push(heading);
		}

		stack.push(heading);
	}

	return roots;
}
