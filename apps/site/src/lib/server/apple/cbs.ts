/** A country bundle's cell-broadcast settings, read off its carrier.plist. Handsets ignore message IDs it does not map. */

import { isRecord } from "@carrier-explode/values";

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

type Rec = Record<string, unknown>;

const rec = (v: unknown): Rec => (isRecord(v) ? v : {});
const recs = (v: unknown): Rec[] => (Array.isArray(v) ? v.filter(isRecord) : []);
const strs = (v: unknown): string[] =>
	Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** A 3GPP message ID range; a single ID has no ToServiceID. */
function range(m: Rec): { from: number; to: number } | undefined {
	const from = num(m.FromServiceID);
	const to = num(m.ToServiceID) ?? from;
	return from === undefined || to === undefined ? undefined : { from, to };
}

function alertType(name: string, v: unknown): CbsAlertType {
	const a = rec(v);
	return {
		name,
		enabledByDefault: bool(a.EnabledByDefault),
		userConfigurable: bool(a.UserConfigurable),
		switchName: str(a.SwitchName),
		notificationTitle: str(a.NotificationTitle),
		soundAlertDeviceInMute: bool(a.SoundAlertDeviceInMute),
		soundIsMutableInDND: bool(a.SoundIsMutableInDND),
	};
}

/** `locales`: the bundle's CBMessage.strings localisations, which say what alert text it carries. */
export function cbsRow(plist: Rec, locales: readonly string[]): CbsRow {
	const cb = rec(plist.CellBroadcast);
	const dup = rec(cb.DuplicateDetectionParameters);
	const mappings = recs(cb.MessageIDParameters3GPP)
		.flatMap((m): CbsMapping[] => {
			const r = range(m);
			return r ? [{ ...r, alertType: str(m.AlertType), configuration: str(m.AlertConfiguration) }] : [];
		})
		.toSorted((a, b) => a.from - b.from);
	const alertTypes = Object.entries(rec(cb.AlertTypes))
		.map(([name, v]) => alertType(name, v))
		.toSorted((a, b) => a.name.localeCompare(b.name));
	return {
		countryName: str(plist.CountryName),
		iso: strs(plist.ISOAlpha2CountryCode),
		hasCellBroadcast: isRecord(plist.CellBroadcast),
		switchGroupTitle: str(cb.SwitchGroupTitle),
		languages: strs(cb.PrimaryBroadcastLanguages),
		geofencing: bool(rec(cb.GeofencingConfiguration).FeatureEnabled),
		duplicateWindowMinutes: num(dup.DuplicationWindowInMinutes),
		interSimDuplicateDetection: bool(dup.PerformInterSimDuplicateDetection),
		intraSimDuplicateDetection: bool(dup.PerformIntraSimDuplicateDetection),
		mappings,
		appleSafetyAlertRanges: recs(rec(cb.AppleSafetyAlert).MessageIDParameters3GPP).flatMap(
			(m) => range(m) ?? [],
		),
		alertTypes,
		alertConfigurations: Object.entries(rec(cb.AlertConfigurations)).map(([name, v]) => {
			const c = rec(v);
			return { name, sound: str(c.Sound), vibration: str(c.Vibration) };
		}),
		emergencyNumbers: recs(rec(plist.EmergencyCalling).EmergencyNumbers).flatMap((e) => str(e.Number) ?? []),
		amlDestination: str(
			rec(rec(rec(rec(rec(plist.Location).EmergencyLocation).AugmentedEmergencyAction).AML).SMS).Destination,
		),
		cbMessageLocales: [...locales].toSorted(),
	};
}
