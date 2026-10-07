/** Queues in memory: what a producer sent, and a batch a consumer acknowledges or leaves to be retried. */

const sent: QueueSendResponse = { metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } } };

export class MemQueue<T> implements Queue<T> {
	readonly bodies: T[] = [];

	metrics(): Promise<QueueMetrics> {
		return Promise.resolve({ backlogCount: this.bodies.length, backlogBytes: 0 });
	}

	send(body: T): Promise<QueueSendResponse> {
		this.bodies.push(body);
		return Promise.resolve(sent);
	}

	sendBatch(messages: Iterable<MessageSendRequest<T>>): Promise<QueueSendBatchResponse> {
		for (const m of messages) this.bodies.push(m.body);
		return Promise.resolve(sent);
	}

	/** Everything sent so far, taken off the queue. */
	take(): T[] {
		return this.bodies.splice(0);
	}
}

/** A batch of `bodies` from `queue`, recording which were acknowledged. */
export function batchOf(
	queue: string,
	bodies: readonly unknown[],
): MessageBatch & { readonly acked: () => number } {
	let acked = 0;
	const messages = bodies.map((body, i): Message => ({
		id: String(i),
		timestamp: new Date(0),
		body,
		attempts: 1,
		retry: () => undefined,
		ack: () => {
			acked++;
		},
	}));
	return {
		messages,
		queue,
		metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
		retryAll: () => undefined,
		ackAll: () => {
			acked = messages.length;
		},
		acked: () => acked,
	};
}
