/** Concepts read off a Profile's APNs, the same way on both platforms. */

import type { Apn, ApnType, Fidelity } from "./types.ts";
import { unset, valueReading, type Unset, type ValueReading } from "./values.ts";

interface ApnView {
	readonly apns: readonly Apn[];
}

/** Android's `all` APN serves every type but initial attach. */
const serves = (a: Apn, type: ApnType): boolean =>
	a.types.includes(type) || (type !== "ia" && a.types.includes("all"));

/** The first APN serving `type`, by name; APN names are case-insensitive (3GPP TS 23.003 9.1). */
export function apnName(type: ApnType): (view: ApnView) => ValueReading<string> | Unset {
	return ({ apns }) => {
		const a = apns.find((x) => serves(x, type));
		return a === undefined ? unset : valueReading(a.apn.toLowerCase(), [{ path: a.path, value: a.apn }]);
	};
}

type ApnValueField = "protocol" | "roamingProtocol" | "mmsc" | "mtu";

/** `field` of the first APN serving `type` that sets it; `native` names the field in the file. */
export function apnField<F extends ApnValueField>(
	type: ApnType,
	field: F,
	native: string,
	fidelity: Fidelity = "exact",
): (view: ApnView) => ValueReading<NonNullable<Apn[F]>> | Unset {
	return ({ apns }) => {
		for (const a of apns) {
			const v = a[field];
			if (v !== undefined && serves(a, type))
				return valueReading(v, [{ path: `${a.path}.${native}`, value: v }], fidelity);
		}
		return unset;
	};
}
