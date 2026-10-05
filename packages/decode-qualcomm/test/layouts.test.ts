/** Tests for `src/layouts.ts` (EfsTools' NV value layouts). */

import { describe, it, expect } from "vitest";
import { hexToBytes } from "@carrier-explode/binary";

import { itemLayout, layoutSize, readLayout } from "../src/layouts.ts";
import { defined } from "./defined.ts";

describe("itemLayout / readLayout", () => {
  it("separates layouts led by an index byte from the rest", () => {
    expect(itemLayout(10)).toEqual({ indexed: true, fields: [["Mode", "u16"]] });
    expect(itemLayout(1897)?.indexed).toBe(false);
    expect(itemLayout("/nv/item_files/modem/mmode/get_net_auto_mode")?.indexed).toBe(false);
    expect(itemLayout(99999)).toBeUndefined();
  });

  it("reads a value of exactly the layout's size, repeated fields as lists and signed types signed", () => {
    // nv:1206 as Pixel configs hold it past its index byte.
    const ppp = defined(itemLayout(1206)).fields;
    expect(layoutSize(ppp)).toBe(26);
    expect(readLayout(ppp, hexToBytes("b80bb80b0a030205b80be803e80314030200e803e80314030300"))).toMatchObject({
      LcpTermTimeout: 3000, LcpAckTimeout: 3000, LcpReqTry: 10, AuthRetry: 5, IpcpTermTimeout: 1000, Ipv6cpCompressionEnable: 0,
    });
    expect(readLayout(defined(itemLayout(34)).fields, hexToBytes("01ff"))).toEqual({ Enabled: [1, -1] });
    expect(readLayout(defined(itemLayout(441)).fields, hexToBytes("ffff"))).toEqual({ Band: -1 });
    expect(readLayout(ppp, hexToBytes("b80b"))).toBeUndefined();
  });
});
