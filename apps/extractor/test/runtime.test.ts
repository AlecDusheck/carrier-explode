// What a step retries (../src/errors.ts), and how a check starts what it plans (../src/runs.ts).

import * as v from "valibot";
import { describe, expect, it } from "vitest";

import { BoundsError, Lz4Error, ProtobufError } from "@carrier-explode/binary";
import { PackError } from "@carrier-explode/decode-samsung";
import {
	bytesSource,
	FsNotFoundError,
	SourceRangeError,
	PayloadFormatError,
	ZipFormatError,
} from "@carrier-explode/firmware";
import { HttpError, RangeResponseError } from "@carrier-explode/http";
import { SqliteError } from "@carrier-explode/sqlite";
import { parseRecord } from "@carrier-explode/storage";
import { GalaxyError } from "../src/galaxy/members.ts";
import { DataError, permanent } from "../src/errors.ts";
import { decide, roomFor } from "../src/runs.ts";

function caught(f: () => unknown): unknown {
	try {
		f();
	} catch (e) {
		return e;
	}
	throw new Error("did not throw");
}

function valiError(): unknown {
	try {
		v.parse(v.string(), 1);
	} catch (e) {
		return e;
	}
	throw new Error("parsed");
}

describe("step retries", () => {
	it("end the instance on bad input or data, and on a request the server refused", () => {
		expect(permanent(valiError())).toBe(true);
		expect(permanent(caught(() => parseRecord("releases/ios/24A446.json", "{")))).toBe(true);
		expect(permanent(new BoundsError(8, 4, 10))).toBe(true);
		expect(permanent(new SourceRangeError(bytesSource(new Uint8Array(10)), 8, 4))).toBe(true);
		expect(permanent(new DataError("others.pb has no version"))).toBe(true);
		expect(permanent(new RangeResponseError("200 for a range"))).toBe(true);
		expect(permanent(new HttpError("u", 404))).toBe(true);
		expect(permanent(new HttpError("u", 403))).toBe(true);
	});

	it("end the instance on bytes a format does not allow, from any package's reader", () => {
		for (const e of [
			new ZipFormatError("no end of central directory"),
			new PayloadFormatError("bad magic"),
			new FsNotFoundError("etc/x", "file"),
			new Lz4Error("bad frame"),
			new ProtobufError(0, "truncated"),
			new PackError("no omc.info"),
			new GalaxyError("no optics.img.lz4"),
			new SqliteError("not an SQLite 3 file"),
		])
			expect([e.name, permanent(e)]).toEqual([e.name, true]);
	});

	it("retry what infrastructure may fix", () => {
		expect(permanent(new HttpError("u", 503))).toBe(false);
		expect(permanent(new HttpError("u", 429))).toBe(false);
		expect(permanent(new HttpError("u", 408))).toBe(false);
		expect(permanent(new TypeError("Network connection lost."))).toBe(false);
		expect(permanent(new Error("D1_ERROR: storage reset"))).toBe(false);
		expect(permanent(new RangeError("Array buffer allocation failed"))).toBe(false);
		expect(permanent(new SyntaxError("Unexpected token '<'"))).toBe(false);
	});
});

describe("a check's starts", () => {
	const runs = [
		{ id: "a", status: null },
		{ id: "b", status: "running" },
		{ id: "c", status: "errored" },
		{ id: "d", status: null },
		{ id: "e", status: "complete" },
	] as const;

	it("start what has no instance, oldest first, up to the free containers; list the live and the failed", () => {
		expect(decide(runs, false, 2)).toEqual({
			started: ["a"],
			restart: [],
			live: ["b"],
			failed: ["c"],
			waiting: ["d"],
		});
		expect(decide(runs, false, Number.POSITIVE_INFINITY)).toEqual({
			started: ["a", "d"],
			restart: [],
			live: ["b"],
			failed: ["c"],
			waiting: [],
		});
	});

	it("restart the failed only when asked to rebuild", () => {
		expect(decide(runs, true, 10)).toEqual({
			started: ["a", "d", "c"],
			restart: ["c"],
			live: ["b"],
			failed: [],
			waiting: [],
		});
	});

	it("give iOS builds their container share with no Apple OTA manifest held", () => {
		const env = { CONTAINER_SHARE: { "ios-build": 3, "galaxy-build": 2 } };
		expect(roomFor(env, "ios-build")).toBe(3);
		expect(roomFor(env, "apple-ota")).toBe(Number.POSITIVE_INFINITY);
	});
});
