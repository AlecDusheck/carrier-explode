/** The override files a per-phone tab chooses between, for its body and the head's phone choice alike. */

import { getAppleBundle } from "#lib/api/apple.remote.ts";
import { getBundleOverrides } from "#lib/api/apple.remote.ts";
import { verArgs } from "#lib/format.ts";
import { phoneRows, pickPhoneRow, rowKey, type PhoneRow } from "#lib/apple/phones.ts";
import type { At } from "#lib/types.ts";
import type { Tab } from "../../../params.ts";

/** Settings shows a phone's own file; Modem every file, those named for no phone too. Country bundles hold none. */
export async function tabPhoneRows(at: At, tab: Tab): Promise<PhoneRow[]> {
	const args = verArgs(at);
	const [bundle, ov] = await Promise.all([
		getAppleBundle(args),
		at.ref.kind === "country" ? null : getBundleOverrides(args),
	]);
	const rows = phoneRows(at.version, bundle.info.files, ov);
	return tab === "settings" ? rows.filter((r) => r.phones.length) : rows;
}

/** The phones the Overview's features are for, and their file: the row Settings shows, as `?file=` names it. */
export async function overviewPhones(
	at: At,
	file: string | null,
): Promise<{ readonly phones: string[]; readonly file: string | null }> {
	if (at.ref.kind !== "carrier") return { phones: [], file: null };
	const { row } = pickPhoneRow(await tabPhoneRows(at, "settings"), file);
	return { phones: row?.phones.map((p) => p.code) ?? [], file: row === undefined ? null : rowKey(row) };
}
