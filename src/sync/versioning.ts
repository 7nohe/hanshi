export function isStaleEditVersion(
	messageVersion: number,
	documentVersion: number,
): boolean {
	return messageVersion < documentVersion;
}
