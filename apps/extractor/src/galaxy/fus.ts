/**
 * Samsung's firmware update server (FUS), as Smart Switch speaks to it. Ported from zacharee/SamloaderKotlin's FusClient,
 * CryptUtils.authenticateBlock and auth_param.dat (MIT, Copyright (c) 2021 Zachary Wander).
 */

import { createHash } from "node:crypto";

import { bytesToHex, u32le } from "@carrier-explode/binary";
import { childText, parseXml, type XmlElement } from "@carrier-explode/decode-samsung";
import { fetchWithRetry, HttpError } from "@carrier-explode/http";
import params from "./auth-param.dat";

const SERVER = "https://neofussvr.sslcs.cdngc.net/";
const INFORM = "NF_SmartDownloadBinaryInform.do";
/** Where a firmware's phone is named and its build dated. */
export const FUS_INFORM = `${SERVER}${INFORM}`;
const CLOUD = "http://cloud-neofussvr.samsungmobile.com/NF_SmartDownloadBinaryForMass.do";
const USER_AGENT = "SMART 2.0";

const PARAMS = new Uint8Array(params);

const HEADER = 56;
/** The header's i32 words: magic, alignment, then six blocks of (offset, size); the cipher reads three of the sizes. */
const word = (i: number): number => u32le(PARAMS, i * 4);
const BLOCK1 = word(3);
const BLOCK2 = word(5);
const BLOCK3 = word(11);
/** AES ShiftRows as a byte permutation. */
const SHIFT = [0, 5, 10, 15, 4, 9, 14, 3, 8, 13, 2, 7, 12, 1, 6, 11] as const;

const at = (pos: number): number => PARAMS[HEADER + pos] ?? 0;

function authenticateBlock(input: Uint8Array): Uint8Array {
	const temp = new Int32Array(320);
	for (let i = 0; i < 16; i++) temp[i] = input[i] ?? 0;
	const v15 = new Int32Array(64);
	for (let j = 0; j < 9; j++) {
		const src = j * 32;
		const next = (j + 1) * 32;
		const mid = src + 16;
		for (let idx = 0; idx < 16; idx++) temp[mid + idx] = temp[src + (SHIFT[idx] ?? 0)] ?? 0;
		for (let i = 0; i < 4; i++) {
			const i4 = i << 2;
			const i16 = i << 4;
			const row = j * 16 + i4;
			const tables = BLOCK1 + BLOCK2 + BLOCK3 + 6144 * (i + (j << 2));
			for (let k = 0; k < 4; k++) {
				const blk = row + k;
				const base = blk * 4096 + (temp[mid + i4 + k] ?? 0) * 16;
				const selector = BLOCK1 + BLOCK2 + blk * 32;
				for (let o = 0; o < 4; o++) {
					let acc = 0;
					for (let bit = 0; bit < 8; bit++) {
						const sel = at(selector + o * 8 + bit);
						const srcIdx = (sel >> 3) & 0x1f;
						const srcByte = srcIdx < 16 ? at(base + srcIdx) : 0;
						acc |= ((srcByte >> (7 - (sel & 7))) & 1) << (7 - bit);
					}
					v15[i16 + k * 4 + o] = acc & 0xff;
				}
			}
			for (let k = 0; k < 4; k++) {
				const a1 = v15[i16 + k] ?? 0,
					a2 = v15[i16 + k + 4] ?? 0,
					a3 = v15[i16 + k + 8] ?? 0,
					a4 = v15[i16 + k + 12] ?? 0;
				const t = tables + 1536 * k;
				const v6 =
					((16 * at(t + (((a1 & 0xf0) | (a2 >> 4)) & 0xff))) ^
						at(t + 256 + ((((a1 & 0x0f) << 4) | (a2 & 0x0f)) & 0xff))) &
					0xff;
				const v7 =
					((16 * at(t + 512 + (((a3 & 0xf0) | (a4 >> 4)) & 0xff))) ^
						at(t + 768 + ((((a3 & 0x0f) << 4) | (a4 & 0x0f)) & 0xff))) &
					0xff;
				temp[next + i4 + k] =
					((16 * at(t + 1024 + (((v6 & 0xf0) | (v7 >> 4)) & 0xff))) ^
						at(t + 1280 + ((((v6 & 0x0f) << 4) | (v7 & 0x0f)) & 0xff))) &
					0xff;
			}
		}
	}
	return Uint8Array.from({ length: 16 }, (_, idx) =>
		at(BLOCK1 + idx * 256 + (temp[(SHIFT[idx] ?? 0) + 288] ?? 0)),
	);
}

/** The server's 16-character nonce, signed: what the Authorization header carries as `signature`. */
const signNonce = (nonce: string): string =>
	bytesToHex(authenticateBlock(new TextEncoder().encode(nonce.slice(0, 16).padEnd(16, "0"))));

export class FusError extends Error {
	override name = "FusError";
}

/** FUS answered with an HTTP error; its body's start names who refused (a WAF's block page). */
export class FusHttpError extends HttpError {
	override name = "FusHttpError";
	constructor(url: string, status: number, body: string) {
		super(url, status);
		this.message = `${this.message}: ${body.slice(0, 200)}`;
	}
}

/** A firmware as FUS names it: the model, the region (CSC) it is served for, and its `PDA/CSC/PHONE/DATA` version. */
export interface FirmwareRef {
	readonly model: string;
	readonly region: string;
	readonly version: string;
}

/** What BinaryInform says of a firmware. */
export interface Inform {
	/** `SM-S931B_3_20260811193230_413hdqeipb_fac.zip.enc4`: the timestamp is when it was built. */
	readonly binaryName: string;
	readonly modelPath: string;
	readonly size: number;
	/** `Galaxy S25 (SM-S931B)`. */
	readonly displayName: string;
	/** The `PDA/CSC/PHONE/DATA` FUS serves, which may complete the one asked for. */
	readonly version: string;
	readonly logicValue: string;
	readonly modelType: string;
	readonly cscFile: string;
}

/** Each character of the nonce picks a character of `input`: FUS's LOGIC_CHECK. */
const logicCheck = (input: string, nonce: string): string =>
	input.length < 16 ? "" : [...nonce].map((c) => input[c.charCodeAt(0) & 0xf] ?? "").join("");

const md5 = (s: string): Uint8Array => new Uint8Array(createHash("md5").update(s).digest());

const escape = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function message(puts: ReadonlyArray<readonly [string, string | number]>, get?: string): string {
	const put = puts.map(([k, v]) => `<${k}><Data>${escape(String(v))}</Data></${k}>`).join("");
	const getPart = get === undefined ? "" : `<Get><CmdID>2</CmdID><${get}/></Get>`;
	return `<FUSMsg><FUSHdr><ProtoVer>1</ProtoVer><SessionID>0</SessionID><MsgID>1</MsgID></FUSHdr><FUSBody><Put>${put}</Put>${getPart}</FUSBody></FUSMsg>`;
}

/** FUS's Put values by tag, and its status. */
function answer(xml: string): {
	readonly status: string | undefined;
	readonly put: ReadonlyMap<string, string>;
} {
	const root = parseXml(xml);
	const body = root.children.find((c) => c.name === "FUSBody");
	const results = body?.children.find((c) => c.name === "Results");
	const put: XmlElement | undefined = body?.children.find((c) => c.name === "Put");
	return {
		status: results === undefined ? undefined : childText(results, "Status"),
		put: new Map((put?.children ?? []).map((c) => [c.name, childText(c, "Data") ?? ""])),
	};
}

/** Regions whose BinaryInform must also name a network (`fus.py`, from Smart Switch's requests). */
const NETWORK_OF: Readonly<Record<string, readonly [string, string, string]>> = {
	EUX: ["DE", "262", "01"],
	EUY: ["RS", "220", "01"],
};

/** One conversation with FUS: its nonce, signature and session move on with every answer. */
export class FusSession {
	private nonce = "";
	private signature = "";
	private session = "";
	/** What initDownload readied, which a lapsed download authorization is renewed for. */
	private readied: { readonly fw: FirmwareRef; readonly inform: Inform } | undefined;
	/** The renewal in flight: downloads refused at once share it. */
	private renewing: Promise<void> | undefined;

	private authorization(): string {
		return `FUS nonce="${this.nonce}", signature="${this.signature}", nc="", type="", realm=""`;
	}

	private take(res: Response): void {
		const nonce = res.headers.get("nonce");
		if (nonce) {
			this.nonce = nonce.slice(0, 16);
			this.signature = signNonce(this.nonce);
		}
		const cookie = /(?:JSESSIONID|SESSION)=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1];
		if (cookie !== undefined) this.session = cookie;
	}

	/** A first nonce, which every other request signs. */
	private async ready(): Promise<void> {
		if (this.nonce === "") await this.post("NF_SmartDownloadGenerateNonce.do", "");
		if (this.nonce === "") throw new FusError("GenerateNonce gave no nonce");
	}

	private async post(path: string, body: string): Promise<string> {
		const res = await fetch(`${SERVER}${path}`, {
			method: "POST",
			headers: {
				authorization: this.authorization(),
				"user-agent": USER_AGENT,
				"content-type": "application/xml",
				...(this.session ? { cookie: `JSESSIONID=${this.session};SESSION=${this.session}` } : {}),
			},
			body,
		});
		this.take(res);
		const text = await res.text();
		if (!res.ok) throw new FusHttpError(`${SERVER}${path}`, res.status, text);
		return text;
	}

	async inform(fw: FirmwareRef): Promise<Inform> {
		await this.ready();
		const network = NETWORK_OF[fw.region];
		const puts: Array<readonly [string, string | number]> = [
			["CmdID", 1],
			["REQUEST_TYPE", 2],
			["BINARY_SW_VERSION", fw.version],
			["DEVICE_SN_NUMBER", ""],
			["BINARY_LOCAL_CODE", fw.region],
			["BINARY_MODEL_NAME", fw.model],
			["ACCESS_MODE", 1],
			["BINARY_NATURE", 1],
			["LOGIC_CHECK", logicCheck(fw.version, this.nonce)],
			["DEVICE_IMEI_PUSH", ""],
			...(network === undefined
				? []
				: ([
						["DEVICE_CC_CODE", network[0]],
						["MCC_NUM", network[1]],
						["MNC_NUM", network[2]],
					] as const)),
		];
		const { status, put } = answer(await this.post(INFORM, message(puts, "BINARY_SW_VERSION")));
		if (status !== "200" && status !== "S00")
			throw new FusError(`${fw.model} ${fw.region} ${fw.version}: BinaryInform status ${status ?? "none"}`);
		const need = (k: string): string => {
			const v = put.get(k);
			if (!v) throw new FusError(`${fw.model} ${fw.region} ${fw.version}: BinaryInform without ${k}`);
			return v;
		};
		return {
			binaryName: need("BINARY_NAME"),
			modelPath: need("MODEL_PATH"),
			size: Number(need("BINARY_BYTE_SIZE")),
			displayName: (put.get("BINARY_MODEL_DISPLAYNAME") ?? fw.model).trim(),
			version: need("BINARY_SW_VERSION"),
			logicValue: put.get("LOGIC_VALUE_FACTORY") || need("LOGIC_VALUE_HOME"),
			modelType: put.get("DEVICE_MODEL_TYPE") ?? "",
			cscFile: need("DEVICE_CSC_FILE"),
		};
	}

	/** Readies the file for download; FUS refuses a download it was not told of. */
	async initDownload(fw: FirmwareRef, inform: Inform): Promise<void> {
		const puts: Array<readonly [string, string | number]> = [
			["BINARY_NAME", inform.binaryName],
			["LOGIC_CHECK", logicCheck(inform.binaryName.slice(-25, -9), this.nonce)],
			["BINARY_SW_VERSION", inform.version],
			["DEVICE_LOCAL_CODE", fw.region],
			...(inform.modelType ? ([["DEVICE_MODEL_TYPE", inform.modelType]] as const) : []),
		];
		const { status } = answer(await this.post("NF_SmartDownloadBinaryInitForMass.do", message(puts)));
		if (status !== "200" && status !== "S00")
			throw new FusError(`${inform.binaryName}: BinaryInitForMass status ${status ?? "none"}`);
		this.readied = { fw, inform };
	}

	/**
	 * Bytes [start, end) of the readied file. A download's authorization lapses soon after it is granted (a 401), so it
	 * is renewed with a new nonce, once for all downloads refused with the same one.
	 */
	async download(start: number, end: number): Promise<ReadableStream<Uint8Array>> {
		const readied = this.readied;
		if (readied === undefined) throw new FusError("download before initDownload");
		const url = `${CLOUD}?file=${readied.inform.modelPath}${readied.inform.binaryName}`;
		const get = (): Promise<Response> =>
			fetchWithRetry(url, {
				headers: {
					authorization: this.authorization(),
					"user-agent": USER_AGENT,
					"cache-control": "no-cache",
					range: `bytes=${start}-${end - 1}`,
				},
			});
		const nonce = this.nonce;
		const res = await get().catch(async (e: unknown) => {
			if (!(e instanceof HttpError) || e.status !== 401) throw e;
			if (this.nonce === nonce)
				await (this.renewing ??= this.renew(readied).finally(() => {
					this.renewing = undefined;
				}));
			return get();
		});
		if (res.status !== 206 || res.body === null)
			throw new FusError(`${url}: bytes ${start}-${end - 1} answered ${res.status}`);
		return res.body;
	}

	private async renew(readied: { readonly fw: FirmwareRef; readonly inform: Inform }): Promise<void> {
		const lapsed = this.nonce;
		await this.initDownload(readied.fw, readied.inform);
		if (this.nonce === lapsed)
			throw new FusError(`${readied.inform.binaryName}: BinaryInitForMass gave no new nonce`);
	}
}

/** The enc4 file's AES-128 key: MD5 of FUS's logic check of the version against its logic value. */
export const enc4Key = (inform: Inform): Uint8Array => md5(logicCheck(inform.version, inform.logicValue));

/** `SM-S931B_3_20260811193230_…` → `2026-08-11`. */
export function builtOn(inform: Inform): string {
	const m = /_(\d{4})(\d{2})(\d{2})\d{6}_/.exec(inform.binaryName);
	if (!m) throw new FusError(`${inform.binaryName}: no build time in the file name`);
	return `${m[1]}-${m[2]}-${m[3]}`;
}
