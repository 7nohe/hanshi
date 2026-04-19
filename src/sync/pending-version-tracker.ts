export class PendingVersionTracker {
	private readonly pending = new Set<number>();

	public mark(version: number): void {
		this.pending.add(version);
	}

	public consume(version: number): boolean {
		const exists = this.pending.has(version);
		this.pending.delete(version);
		return exists;
	}

	public clear(): void {
		this.pending.clear();
	}
}
