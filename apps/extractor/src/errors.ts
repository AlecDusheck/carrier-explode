/** Errors as one line, and which failures a step retry cannot fix: bad input or data, and requests the server refused. */

import { BoundsError, Lz4Error, ProtobufError, VarintError } from "@carrier-explode/binary";
import { MissingFieldError } from "@carrier-explode/decode-android";
import { McfError } from "@carrier-explode/decode-mediatek";
import { CarrierFeatureError, ImsError, PackError, XmlError } from "@carrier-explode/decode-samsung";
import { ShannonFormatError } from "@carrier-explode/decode-shannon";
import {
	FsError,
	LzfseError,
	PartitionError,
	PayloadFormatError,
	SourceRangeError,
	SparseError,
	SuperError,
	XzError,
	ZipFormatError,
} from "@carrier-explode/firmware";
import { HttpError, RangeResponseError } from "@carrier-explode/http";
import { SqliteError } from "@carrier-explode/sqlite";
import { RecordError } from "@carrier-explode/storage";
import { ValiError } from "valibot";

/** An error as one line, with an AggregateError's causes. */
export function describe(e: unknown): string {
	if (e instanceof AggregateError) return `${e.message} (${e.errors.map(describe).join("; ")})`;
	return e instanceof Error ? e.message : String(e);
}

/** A file that is not what its format or its source says it must be: a retry reads the same bytes. */
export class DataError extends Error {
	override name = "DataError";
}

/** A failure that is the caller's, with its status. */
export class RequestError extends Error {
	override name = "RequestError";
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

/** The packages' errors for bytes their format does not allow, or a read past their end. */
const FORMAT_ERRORS = [
	BoundsError,
	SourceRangeError,
	ZipFormatError,
	PayloadFormatError,
	PartitionError,
	SuperError,
	FsError,
	SparseError,
	Lz4Error,
	XzError,
	LzfseError,
	ProtobufError,
	VarintError,
	MissingFieldError,
	McfError,
	ShannonFormatError,
	PackError,
	XmlError,
	ImsError,
	CarrierFeatureError,
	RecordError,
	SqliteError,
] as const;

/** A WAF's refusal of a burst of requests: an immediate retry meets it too, a run some minutes on is served. */
export class BurstRefusal extends Error {
	override name = "BurstRefusal";
}

const TRANSIENT_STATUSES: ReadonlySet<number> = new Set([408, 429]);

export function permanent(e: unknown): boolean {
	if (e instanceof HttpError) return e.status < 500 && !TRANSIENT_STATUSES.has(e.status);
	return (
		e instanceof DataError ||
		e instanceof BurstRefusal ||
		e instanceof ValiError ||
		e instanceof RangeResponseError ||
		FORMAT_ERRORS.some((format) => e instanceof format)
	);
}

/** How a failed step runs again: at once, never, or once a burst refusal has lifted (unit.ts). */
export const FAILURES = ["transient", "permanent", "burst"] as const;
export type Failure = (typeof FAILURES)[number];

export const failureOf = (e: unknown): Failure =>
	e instanceof BurstRefusal ? "burst" : permanent(e) ? "permanent" : "transient";

/** Starts the error of a unit whose step met a burst refusal twice: an instance's error keeps only its message. */
export const REFUSED_TWICE = "refused twice:";

/** An instance a burst refusal ended: worth a restart, unlike any other failure. */
export const refusedTwice = (s: InstanceStatus): boolean =>
	s.status === "errored" && s.error?.message.startsWith(REFUSED_TWICE) === true;
