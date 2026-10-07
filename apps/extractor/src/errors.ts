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

const TRANSIENT_STATUSES: ReadonlySet<number> = new Set([408, 429]);

export function permanent(e: unknown): boolean {
	if (e instanceof HttpError) return e.status < 500 && !TRANSIENT_STATUSES.has(e.status);
	return (
		e instanceof DataError ||
		e instanceof ValiError ||
		e instanceof RangeResponseError ||
		FORMAT_ERRORS.some((format) => e instanceof format)
	);
}
