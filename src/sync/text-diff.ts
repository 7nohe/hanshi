export interface ReplaceRange {
	start: number;
	end: number;
	text: string;
}

export function computeMinimalReplaceRange(
	current: string,
	next: string,
): ReplaceRange | undefined {
	if (current === next) {
		return undefined;
	}

	let prefix = 0;
	const maxPrefix = Math.min(current.length, next.length);
	while (
		prefix < maxPrefix &&
		current.charCodeAt(prefix) === next.charCodeAt(prefix)
	) {
		prefix += 1;
	}

	let currentSuffix = current.length;
	let nextSuffix = next.length;
	while (
		currentSuffix > prefix &&
		nextSuffix > prefix &&
		current.charCodeAt(currentSuffix - 1) === next.charCodeAt(nextSuffix - 1)
	) {
		currentSuffix -= 1;
		nextSuffix -= 1;
	}

	return {
		start: prefix,
		end: currentSuffix,
		text: next.slice(prefix, nextSuffix),
	};
}
