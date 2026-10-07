/** Bytes pulled from an async stream: what the streaming readers parse their headers and bodies from. */

export class StreamEndError extends Error {
	override name = "StreamEndError";
}

/** Bytes pulled from a stream on demand, queued as they come, each copied once into what `take` returns. */
export class Pull {
	private readonly queue: Uint8Array[] = [];
	private queued = 0;
	private done = false;
	constructor(private readonly it: AsyncIterator<Uint8Array>) {}

	/** Whether `n` more bytes can be taken; false when the stream ends first. */
	async has(n: number): Promise<boolean> {
		while (this.queued < n && !this.done) {
			const next = await this.it.next();
			if (next.done) this.done = true;
			else if (next.value.length) {
				this.queue.push(next.value);
				this.queued += next.value.length;
			}
		}
		return this.queued >= n;
	}

	async take(n: number): Promise<Uint8Array> {
		if (!(await this.has(n))) throw new StreamEndError(`the stream ended ${n - this.queued} bytes short`);
		const out = new Uint8Array(n);
		for (let at = 0; at < n;) {
			const head = this.queue[0];
			if (head === undefined) break;
			const k = Math.min(head.length, n - at);
			out.set(head.subarray(0, k), at);
			at += k;
			if (k === head.length) this.queue.shift();
			else this.queue[0] = head.subarray(k);
		}
		this.queued -= n;
		return out;
	}
}
