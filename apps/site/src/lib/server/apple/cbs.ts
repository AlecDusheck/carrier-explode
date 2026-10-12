/** A country bundle's cell-broadcast settings, read off its carrier.plist. Handsets ignore message IDs it does not map. */

import { cbsRange, emergencyNumberList } from "@carrier-explode/schema";
import { isRecord } from "@carrier-explode/values";
import * as v from "valibot";

interface CbsMapping {
	readonly from: number;
	readonly to: number;
	readonly alertType?: string | undefined;
	readonly configuration?: string | undefined;
}

interface CbsAlertType {
	readonly name: string;
	readonly enabledByDefault?: boolean | undefined;
	readonly userConfigurable?: boolean | undefined;
	readonly switchName?: string | undefined;
	readonly notificationTitle?: string | undefined;
	readonly soundAlertDeviceInMute?: boolean | undefined;
	readonly soundIsMutableInDND?: boolean | undefined;
}

/** One country bundle's cell-broadcast settings, from its carrier.plist. */
export interface CbsRow {
	readonly countryName?: string | undefined;
	readonly iso: readonly string[];
	readonly switchGroupTitle?: string | undefined;
	readonly languages: readonly string[];
	readonly geofencing?: boolean | undefined;
	readonly duplicateWindowMinutes?: number | undefined;
	readonly interSimDuplicateDetection?: boolean | undefined;
	readonly intraSimDuplicateDetection?: boolean | undefined;
	readonly mappings: readonly CbsMapping[];
	readonly alertTypes: readonly CbsAlertType[];
	readonly alertConfigurations: ReadonlyArray<{
		readonly name: string;
		readonly sound?: string | undefined;
		readonly vibration?: string | undefined;
	}>;
	readonly appleSafetyAlertRanges: ReadonlyArray<{ readonly from: number; readonly to: number }>;
	readonly emergencyNumbers: readonly string[];
	readonly amlDestination?: string | undefined;
	readonly cbMessageLocales: readonly string[];
	/** false = the bundle carries no CellBroadcast dictionary at all. */
	readonly hasCellBroadcast: boolean;
}

/** A value the handset ignores reads as absent. */
const maybe = <S extends v.GenericSchema>(schema: S) => v.fallback(v.optional(schema), undefined);
/** Anything but a dictionary reads as an empty one. */
const dict = <S extends v.GenericSchema<Record<string, unknown>>>(schema: S) =>
	v.optional(
		v.pipe(
			v.unknown(),
			v.transform((x) => (isRecord(x) ? x : {})),
			schema,
		),
		{},
	);
/** A list's entries of one kind; anything else, the list included, is skipped. */
const entries = <T, S extends v.GenericSchema<T>>(is: (x: unknown) => x is T, schema: S) =>
	v.optional(
		v.pipe(
			v.unknown(),
			v.transform((x) => (Array.isArray(x) ? x.filter(is) : [])),
			v.array(schema),
		),
		[],
	);
const isString = (x: unknown): x is string => typeof x === "string";
const strings = entries(isString, v.string());

const alertTypeSchema = dict(
	v.object({
		EnabledByDefault: maybe(v.boolean()),
		UserConfigurable: maybe(v.boolean()),
		SwitchName: maybe(v.string()),
		NotificationTitle: maybe(v.string()),
		SoundAlertDeviceInMute: maybe(v.boolean()),
		SoundIsMutableInDND: maybe(v.boolean()),
	}),
);
const mappingSchema = v.looseObject({ AlertType: maybe(v.string()), AlertConfiguration: maybe(v.string()) });
const ranges = entries(isRecord, v.looseObject({}));

/** The parts of carrier.plist the Alerts tab reads. */
const cbsPlistSchema = v.object({
	CountryName: maybe(v.string()),
	ISOAlpha2CountryCode: strings,
	CellBroadcast: dict(
		v.object({
			SwitchGroupTitle: maybe(v.string()),
			PrimaryBroadcastLanguages: strings,
			GeofencingConfiguration: dict(v.object({ FeatureEnabled: maybe(v.boolean()) })),
			DuplicateDetectionParameters: dict(
				v.object({
					DuplicationWindowInMinutes: maybe(v.number()),
					PerformInterSimDuplicateDetection: maybe(v.boolean()),
					PerformIntraSimDuplicateDetection: maybe(v.boolean()),
				}),
			),
			MessageIDParameters3GPP: entries(isRecord, mappingSchema),
			AlertTypes: dict(v.record(v.string(), alertTypeSchema)),
			AppleSafetyAlert: dict(v.object({ MessageIDParameters3GPP: ranges })),
			AlertConfigurations: dict(
				v.record(v.string(), dict(v.object({ Sound: maybe(v.string()), Vibration: maybe(v.string()) }))),
			),
		}),
	),
	EmergencyCalling: dict(v.object({ EmergencyNumbers: v.optional(v.unknown()) })),
	EmergencyNumbers: v.optional(v.unknown()),
	Location: dict(
		v.object({
			EmergencyLocation: dict(
				v.object({
					AugmentedEmergencyAction: dict(
						v.object({
							AML: dict(v.object({ SMS: dict(v.object({ Destination: maybe(v.string()) })) })),
						}),
					),
				}),
			),
		}),
	),
});

/** `locales`: the bundle's CBMessage.strings localisations, which say what alert text it carries. */
export function cbsRow(plist: Readonly<Record<string, unknown>>, locales: readonly string[]): CbsRow {
	const p = v.parse(cbsPlistSchema, plist);
	const cb = p.CellBroadcast;
	const dup = cb.DuplicateDetectionParameters;
	const mappings = cb.MessageIDParameters3GPP.flatMap((m): CbsMapping[] => {
		const r = cbsRange(m);
		return r ? [{ ...r, alertType: m.AlertType, configuration: m.AlertConfiguration }] : [];
	}).toSorted((a, b) => a.from - b.from);
	const alertTypes = Object.entries(cb.AlertTypes)
		.map(([name, a]): CbsAlertType => ({
			name,
			enabledByDefault: a.EnabledByDefault,
			userConfigurable: a.UserConfigurable,
			switchName: a.SwitchName,
			notificationTitle: a.NotificationTitle,
			soundAlertDeviceInMute: a.SoundAlertDeviceInMute,
			soundIsMutableInDND: a.SoundIsMutableInDND,
		}))
		.toSorted((a, b) => a.name.localeCompare(b.name));
	return {
		countryName: p.CountryName,
		iso: p.ISOAlpha2CountryCode,
		hasCellBroadcast: isRecord(plist.CellBroadcast),
		switchGroupTitle: cb.SwitchGroupTitle,
		languages: cb.PrimaryBroadcastLanguages,
		geofencing: cb.GeofencingConfiguration.FeatureEnabled,
		duplicateWindowMinutes: dup.DuplicationWindowInMinutes,
		interSimDuplicateDetection: dup.PerformInterSimDuplicateDetection,
		intraSimDuplicateDetection: dup.PerformIntraSimDuplicateDetection,
		mappings,
		appleSafetyAlertRanges: cb.AppleSafetyAlert.MessageIDParameters3GPP.flatMap((m) => cbsRange(m) ?? []),
		alertTypes,
		alertConfigurations: Object.entries(cb.AlertConfigurations).map(([name, c]) => ({
			name,
			sound: c.Sound,
			vibration: c.Vibration,
		})),
		emergencyNumbers: emergencyNumberList(p.EmergencyCalling.EmergencyNumbers, p.EmergencyNumbers),
		amlDestination: p.Location.EmergencyLocation.AugmentedEmergencyAction.AML.SMS.Destination,
		cbMessageLocales: [...locales].toSorted(),
	};
}
