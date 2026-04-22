/**
 * Markdown escape characters that remark-parse strips from AST values.
 *
 * Per CommonMark spec, any ASCII punctuation character can be backslash-
 * escaped.  remark-parse removes the `\` and puts the bare character into
 * `text.value`.  The custom `stringifyText` handler then protects some of
 * those characters (`*`, `[`, `$`) with PUA sentinels to avoid *double*
 * escaping, but this also prevents remark-stringify from re-adding the `\`
 * that was present in the original source.
 *
 * This module compares the reference source line-by-line with the
 * normalized output.  Where the only difference is missing backslash
 * escapes, the reference line is restored — exactly matching the existing
 * `restoreAutolinkBrackets` / `restoreTableSeparators` post-processing
 * pattern.
 */

/**
 * ASCII punctuation characters that CommonMark allows to be backslash-
 * escaped.  The regex below matches `\` followed by one of these.
 */
const ESCAPABLE =
	/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g;

/**
 * Restores backslash escapes that were present in the reference markdown
 * but dropped during normalization.
 *
 * Strategy: compare line-by-line.  For each reference line that contains
 * at least one `\X` escape, strip those backslashes and check whether the
 * result equals the corresponding normalized line.  If so, the reference
 * line is a faithful representation and we restore it.
 */
export function restoreEscapes(
	normalized: string,
	reference: string,
): string {
	const normLines = normalized.split("\n");
	const refLines = reference.split("\n");

	// Only attempt restoration when line counts match — if the structure
	// diverged (e.g. an escape loss turned a paragraph into emphasis + two
	// paragraphs), we cannot safely map lines.
	if (normLines.length !== refLines.length) {
		return normalized;
	}

	let changed = false;

	for (let i = 0; i < refLines.length; i++) {
		const refLine = refLines[i];
		const normLine = normLines[i];

		// Skip lines that have no escapes in the reference.
		if (!refLine.includes("\\")) continue;

		// Strip all backslash escapes from the reference line.
		const refStripped = refLine.replace(ESCAPABLE, "$1");

		// If the stripped reference equals the normalized line, the only
		// difference was the backslash escapes — restore the reference line.
		if (refStripped === normLine) {
			normLines[i] = refLine;
			changed = true;
		}
	}

	return changed ? normLines.join("\n") : normalized;
}
