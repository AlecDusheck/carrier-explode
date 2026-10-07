/** Exact-length reads off a stream of chunks, holding no more than the current record. */

export class ByteQueue {
	readonly #it: AsyncIterator<Uint8Array>;
	#chunks: Uint8Array[] = [];
	#have = 0;
	#done = false;
	#consumed = 0;

	constructor(source: AsyncIterable<Uint8Array>) {
		this.#it = source[Symbol.asyncIterator]();
	}

	async #fill(n: number): Promise<void> {
		while (this.#have < n && !this.#done) {
			const r = await this.#it.next();
			if (r.done) this.#done = true;
			else {
				this.#chunks.push(r.value);
				this.#have += r.value.length;
			}
		}
	}

	/** Exactly `n` bytes; throws if the stream ends first. */
	async read(n: number): Promise<Uint8Array> {
		await this.#fill(n);
		if (this.#have < n)
			throw new Error(
				`stream ended at byte ${this.#consumed + this.#have}, ${n - this.#have} short of a ${n}-byte read`,
			);
		const out = new Uint8Array(n);
		for (let at = 0; at < n;) {
			const [head] = this.#chunks;
			if (!head) throw new Error("byte queue lost track of its chunks");
			const take = Math.min(head.length, n - at);
			out.set(head.subarray(0, take), at);
			at += take;
			if (take === head.length) this.#chunks.shift();
			else this.#chunks[0] = head.subarray(take);
		}
		this.#have -= n;
		this.#consumed += n;
		return out;
	}

	/** Everything left, for trailers whose length the format leaves implicit. */
	async rest(): Promise<Uint8Array> {
		await this.#fill(Number.POSITIVE_INFINITY);
		return this.read(this.#have);
	}
}
