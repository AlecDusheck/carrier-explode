/**
 * Overrides of what the data says about a code, one value per subject, code and field, applied where pages read names.
 * Adding a kind of override is an entry in LABEL_FIELDS.
 */

import * as v from "valibot";

/**
 * What labels are about: a phone (product type or Pixel codename), a carrier (its id), a modem (iOS generation or
 * Android vendor), a source (its key), whose labels hold for the carrier it is linked into, whatever that carrier's id.
 */
export const LABEL_SUBJECTS = ["device", "carrier", "modem", "source"] as const;
export type LabelSubject = (typeof LABEL_SUBJECTS)[number];

/** Who wrote a label. The data a value is derived from ranks just above `feed`: more trusted origins override it, the rest fill its gaps. */
export const LABEL_ORIGINS = ["feed", "human", "model"] as const;
export type LabelOrigin = (typeof LABEL_ORIGINS)[number];

export interface LabelField {
	readonly value: v.GenericSchema<string>;
	/** The origins that may write the field, most trusted first. */
	readonly trust: readonly [LabelOrigin, ...LabelOrigin[]];
}

/** A maker's own name for its product beats a person's, which beats a model's guess. */
const NAME = {
	value: v.pipe(
		v.string(),
		v.minLength(1),
		v.maxLength(80),
		v.check((s) => s.trim() === s, "a name has no outer spaces"),
	),
	trust: ["feed", "human", "model"],
} as const satisfies LabelField;

/** A person's name for a carrier beats the data's, which hides brands behind hosts (Verizon_Comcast_LTE_US) and former names. */
const CARRIER_NAME = { ...NAME, trust: ["human", "feed", "model"] } as const satisfies LabelField;

/** Only people name a carrier through one of its sources. */
const SOURCE_CARRIER_NAME = { ...NAME, trust: ["human"] } as const satisfies LabelField;

/** A person's correction beats a feed's date: a feed can lose a phone's first builds (Google drops a Pixel's history). */
const RELEASED = {
	value: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}(-\d{2})?$/)),
	trust: ["human", "feed"],
} as const satisfies LabelField;

export const LABEL_FIELDS = {
	device: { name: NAME, released: RELEASED },
	carrier: { name: CARRIER_NAME },
	modem: { name: NAME },
	source: { carrierName: SOURCE_CARRIER_NAME },
} as const satisfies { readonly [S in LabelSubject]: Readonly<Record<string, LabelField>> };

export type LabelFieldName<S extends LabelSubject> = keyof (typeof LABEL_FIELDS)[S] & string;

const keysOf = <T extends object>(o: T): Array<keyof T & string> =>
	Object.keys(o).filter((k): k is keyof T & string => Object.hasOwn(o, k));

const rowOf = <S extends LabelSubject>(subject: S) =>
	v.object({
		subject: v.literal(subject),
		code: v.pipe(v.string(), v.minLength(1)),
		field: v.picklist(keysOf<(typeof LABEL_FIELDS)[S]>(LABEL_FIELDS[subject])),
		value: v.string(),
		origin: v.picklist(LABEL_ORIGINS),
		/** The page the value was read from; a person's may cite none. */
		evidence: v.nullable(v.string()),
	});

const labelRowSchema = v.variant("subject", [
	rowOf("device"),
	rowOf("carrier"),
	rowOf("modem"),
	rowOf("source"),
]);
type LabelRow = v.InferOutput<typeof labelRowSchema>;

/** The field a label sets. */
export function labelField(l: Pick<LabelRow, "subject" | "field">): LabelField {
	const fields: Readonly<Record<string, LabelField>> = LABEL_FIELDS[l.subject];
	const field = fields[l.field];
	if (field === undefined) throw new Error(`${l.subject} has no label field ${l.field}`);
	return field;
}

/** A label whose value fits its field, from an origin the field takes. */
export const labelSchema = v.pipe(
	labelRowSchema,
	v.check((l) => v.is(labelField(l).value, l.value), "a label's value must fit its field"),
	v.check((l) => labelField(l).trust.includes(l.origin), "a label's origin must be one its field takes"),
);
export type Label = v.InferOutput<typeof labelSchema>;

/** Lower is more trusted; an origin the field does not take ranks below all. */
export const trustRank = (field: LabelField, origin: LabelOrigin): number => {
	const rank = field.trust.indexOf(origin);
	return rank < 0 ? field.trust.length : rank;
};
