/**
 * CarrierList (AOSP carrier_list.proto), carrier_list.pb: which SIMs map to
 * which canonical name. Each CarrierId is an MCC+MNC plus at most one MVNO
 * discriminator (spn, imsi prefix pattern, or gid1 prefix).
 */

import type { CarrierId, CarrierList, UnknownField } from "./types.ts";
import { WireReader } from "./wire.ts";

function decodeCarrierId(bytes: Uint8Array, path: string, sink: UnknownField[]): CarrierId {
  const r = new WireReader(bytes);
  let mccMnc = "";
  // mvno_data is a oneof: the last member on the wire wins.
  let mvno: { spn: string } | { imsi: string } | { gid1: string } | undefined;
  for (let t = r.tag(); t; t = r.tag()) {
    switch (t.key) {
      case "1:bytes": mccMnc = r.string(); break;
      case "2:bytes": mvno = { spn: r.string() }; break;
      case "3:bytes": mvno = { imsi: r.string() }; break;
      case "4:bytes": mvno = { gid1: r.string() }; break;
      default: sink.push(r.unknown(t, path));
    }
  }
  return { mccMnc, ...mvno };
}

function decodeEntry(bytes: Uint8Array, index: number, sink: UnknownField[]): CarrierList["entries"][number] {
  const r = new WireReader(bytes);
  const entry: CarrierList["entries"][number] = { canonicalName: "", carrierIds: [] };
  for (let t = r.tag(); t; t = r.tag()) {
    if (t.key === "1:bytes") entry.canonicalName = r.string();
    else if (t.key === "2:bytes") entry.carrierIds.push(decodeCarrierId(r.bytes(), `entries[${index}].carrierIds[${entry.carrierIds.length}]`, sink));
    else sink.push(r.unknown(t, `entries[${index}]`));
  }
  return entry;
}

export function decodeCarrierList(bytes: Uint8Array): CarrierList {
  const r = new WireReader(bytes);
  const sink: UnknownField[] = [];
  const out: CarrierList = { entries: [] };
  for (let t = r.tag(); t; t = r.tag()) {
    if (t.key === "1:bytes") out.entries.push(decodeEntry(r.bytes(), out.entries.length, sink));
    else if (t.key === "2:varint") out.version = r.int64();
    else sink.push(r.unknown(t, ""));
  }
  return sink.length ? { ...out, unknown: sink } : out;
}
