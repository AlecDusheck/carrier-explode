/** CarrierList (carrier_list.proto): which SIMs map to which canonical name. */

import type { CarrierId, CarrierList, CarrierMap, Mvno, UnknownField } from "./types.ts";
import { WireReader } from "./wire.ts";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function decodeCarrierId(bytes: Uint8Array, path: string, sink: UnknownField[]): CarrierId {
  const r = new WireReader(bytes);
  const id: Mutable<CarrierId> = {};
  let mvno: Mvno | undefined;
  for (let t = r.tag(); t; t = r.tag()) {
    switch (t.key) {
      case "1:bytes": id.mccMnc = r.string(); break;
      // A oneof: the last member on the wire wins.
      case "2:bytes": mvno = { kind: "spn", value: r.string() }; break;
      case "3:bytes": mvno = { kind: "imsi", value: r.string() }; break;
      case "4:bytes": mvno = { kind: "gid1", value: r.string() }; break;
      default: sink.push(r.unknown(t, path));
    }
  }
  return mvno ? { ...id, mvno } : id;
}

function decodeEntry(bytes: Uint8Array, path: string, sink: UnknownField[]): CarrierMap {
  const r = new WireReader(bytes);
  const carrierIds: CarrierId[] = [];
  const entry: Mutable<CarrierMap> = { carrierIds };
  for (let t = r.tag(); t; t = r.tag()) {
    if (t.key === "1:bytes") entry.canonicalName = r.string();
    else if (t.key === "2:bytes") carrierIds.push(decodeCarrierId(r.bytes(), `${path}.carrierIds[${carrierIds.length}]`, sink));
    else sink.push(r.unknown(t, path));
  }
  return entry;
}

export function decodeCarrierList(bytes: Uint8Array): CarrierList {
  const r = new WireReader(bytes);
  const unknown: UnknownField[] = [];
  const entries: CarrierMap[] = [];
  const list: Mutable<CarrierList> = { entries, unknown };
  for (let t = r.tag(); t; t = r.tag()) {
    if (t.key === "1:bytes") entries.push(decodeEntry(r.bytes(), `entries[${entries.length}]`, unknown));
    else if (t.key === "2:varint") list.version = r.int64();
    else unknown.push(r.unknown(t, ""));
  }
  return list;
}
