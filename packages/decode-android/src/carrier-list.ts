/** CarrierList (carrier_list.proto): which SIMs map to which canonical name. */

import { wireFields } from "@carrier-explode/binary";
import { MissingFieldError } from "./errors.ts";
import type { CarrierId, CarrierList, CarrierMap, Mvno, UnknownField } from "./types.ts";
import { int64, text, unknownField } from "./wire.ts";

function decodeCarrierId(bytes: Uint8Array, path: string, sink: UnknownField[]): CarrierId {
  let mccMnc: string | undefined;
  let mvno: Mvno | undefined;
  for (const f of wireFields(bytes)) {
    switch (f.key) {
      case "1:bytes": mccMnc = text(f.value); break;
      // A oneof: the last member on the wire wins.
      case "2:bytes": mvno = { kind: "spn", value: text(f.value) }; break;
      case "3:bytes": mvno = { kind: "imsi", value: text(f.value) }; break;
      case "4:bytes": mvno = { kind: "gid1", value: text(f.value) }; break;
      default: sink.push(unknownField(f, path));
    }
  }
  if (!mccMnc) throw new MissingFieldError(path, "mcc_mnc");
  return mvno ? { mccMnc, mvno } : { mccMnc };
}

function decodeEntry(bytes: Uint8Array, path: string, sink: UnknownField[]): CarrierMap {
  const carrierIds: CarrierId[] = [];
  let canonicalName: string | undefined;
  for (const f of wireFields(bytes)) {
    if (f.key === "1:bytes") canonicalName = text(f.value);
    else if (f.key === "2:bytes") carrierIds.push(decodeCarrierId(f.value, `${path}.carrierIds[${carrierIds.length}]`, sink));
    else sink.push(unknownField(f, path));
  }
  if (!canonicalName) throw new MissingFieldError(path, "canonical_name");
  return { canonicalName, carrierIds };
}

export function decodeCarrierList(bytes: Uint8Array): CarrierList {
  const unknown: UnknownField[] = [];
  const entries: CarrierMap[] = [];
  let version: string | undefined;
  for (const f of wireFields(bytes)) {
    if (f.key === "1:bytes") entries.push(decodeEntry(f.value, `entries[${entries.length}]`, unknown));
    else if (f.key === "2:varint") version = int64(f.value);
    else unknown.push(unknownField(f, ""));
  }
  return version === undefined ? { entries, unknown } : { version, entries, unknown };
}
