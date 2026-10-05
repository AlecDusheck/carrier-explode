/** cfg.db (`carrierconfig/cfg.db`): which SIMs are which carrier, and which manifest configures each. */

import { type ColumnSpec, openSqlite } from "@carrier-explode/sqlite";
import { ShannonFormatError } from "./wire.ts";

/** The tables read. */
const SPECS = {
  // SIM matchers: one row per (carrier, MCC-MNC, IMSI/SPN/GID/ICCID pattern); `%` is any.
  carrier_info: {
    carrier_id: "integer", mccmnc: "text", imsi_prefix_xpattern: "text", spn: "text", plmn_name: "text?",
    gid1: "text", gid2: "text", preferred_apn: "text?", iccid_prefix: "text?", privelege_access_rule: "text?",
  },
  // The manifest SHA-1 configuring a carrier; a child row repeats its parent's manifest.
  confmap: { carrier_id: "text", confman: "text" },
} as const satisfies Readonly<Record<string, ColumnSpec>>;

/** A carrier_info pattern; `%` (match anything) becomes null. */
type Pattern = string | null;

export interface SimMatcher {
  readonly mccMnc: string;
  /** SQL LIKE patterns, as stored. */
  readonly imsiPrefix: Pattern;
  readonly spn: Pattern;
  readonly gid1: Pattern;
  readonly gid2: Pattern;
  readonly iccidPrefix: string | null;
  /** Hex SHA-256 of the carrier's signing certificate (the carrier-privilege access rule). */
  readonly accessRule: string | null;
  readonly plmnName: string | null;
  readonly preferredApn: string | null;
}

export interface Carrier {
  readonly id: number;
  /** confmap: the SHA-1 of the manifest configuring this carrier. */
  readonly config: { readonly manifest: string } | null;
  readonly matchers: readonly SimMatcher[];
}

export interface CarrierDb {
  readonly carriers: readonly Carrier[];
}

const pattern = (s: string): Pattern => (s === "%" ? null : s);

export function decodeCarrierDb(bytes: Uint8Array): CarrierDb {
  const db = openSqlite(bytes);
  const matchers = new Map<number, SimMatcher[]>();
  for (const r of db.rows("carrier_info", SPECS.carrier_info)) {
    const m: SimMatcher = {
      mccMnc: r.mccmnc,
      imsiPrefix: pattern(r.imsi_prefix_xpattern),
      spn: pattern(r.spn),
      gid1: pattern(r.gid1),
      gid2: pattern(r.gid2),
      iccidPrefix: r.iccid_prefix,
      accessRule: r.privelege_access_rule,
      plmnName: r.plmn_name,
      preferredApn: r.preferred_apn,
    };
    matchers.set(r.carrier_id, [...(matchers.get(r.carrier_id) ?? []), m]);
  }
  const configs = new Map<number, Carrier["config"]>();
  for (const r of db.rows("confmap", SPECS.confmap)) {
    // cfg.db stores confmap's carrier ids as TEXT.
    if (!/^\d+$/.test(r.carrier_id)) throw new ShannonFormatError(`confmap.carrier_id ${JSON.stringify(r.carrier_id)} is not a carrier id`);
    const id = Number(r.carrier_id);
    if (configs.has(id)) throw new ShannonFormatError(`confmap lists carrier ${id} twice`);
    configs.set(id, { manifest: r.confman });
  }
  const ids = [...new Set([...matchers.keys(), ...configs.keys()])].sort((a, b) => a - b);
  return { carriers: ids.map((id) => ({ id, config: configs.get(id) ?? null, matchers: matchers.get(id) ?? [] })) };
}
