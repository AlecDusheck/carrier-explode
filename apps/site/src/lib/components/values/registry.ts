/**
 * Views for modem items whose format is known, each imported only when a page shows one: a modem
 * family's decoder reads the value at ingest (into ModemItem.value). An item gets a view by its
 * base id, or by a shape or name a family's items share; anything else renders as decoded.
 */

import type { Component } from "svelte";
import type { ModemItem } from "@carrier-explode/schema/types";
import { baseId, hardwareGrid, isPlmnCategory, mcfTable } from "./modem/model.ts";

/** A view's module, imported when a page first shows one. */
export type Lazy<P extends Record<string, unknown>> = () => Promise<{ readonly default: Component<P> }>;

/** What a modem item's view is given: the item, and its configuration's items, for items that name one another. */
export type ModemViewProps = { readonly item: ModemItem; readonly items: readonly ModemItem[] };

type ModemLazy = Lazy<ModemViewProps>;

const countedList: ModemLazy = () => import("./modem/CountedList.svelte");
const sidNids: ModemLazy = () => import("./modem/SidNids.svelte");

/** By base id (`nv:1206` for `nv:1206/2@3`). */
export const MODEM_VIEWS: Readonly<Record<string, ModemLazy>> = {
  "nv:255": sidNids,
  "nv:257": () => import("./modem/NvPrl.svelte"),
  "nv:259": sidNids,
  "nv:830": () => import("./modem/SmsRoutes.svelte"),
  "nv:1206": () => import("./modem/PppProfile.svelte"),
  "nv:7162": countedList,
  "efs:/nv/item_files/modem/mmode/sd/sdssscr_timers": countedList,
};

/** Views over a name or shape a family's items share, tried in order when no id matches. */
const MODEM_SHAPES: ReadonlyArray<readonly [(item: ModemItem) => boolean, ModemLazy]> = [
  [isPlmnCategory, () => import("./modem/PlmnCategory.svelte")],
  [(item) => hardwareGrid(item.value) !== undefined, () => import("./modem/HardwareGrid.svelte")],
  [(item) => mcfTable(item.value) !== undefined, () => import("./modem/McfTable.svelte")],
];

/** A view loaded, with the props it is shown with. */
export interface Loaded<P extends Record<string, unknown>> {
  readonly View: Component<P>;
  readonly props: P;
}

/** The item's view, or null to show its value as decoded; `items` is the configuration it is in. */
export function modemView(item: ModemItem, items: readonly ModemItem[]): Promise<Loaded<ModemViewProps>> | null {
  const id = baseId(item.id);
  const load = Object.hasOwn(MODEM_VIEWS, id) ? MODEM_VIEWS[id] : MODEM_SHAPES.find(([fits]) => fits(item))?.[1];
  return load ? load().then(({ default: View }) => ({ View, props: { item, items } })) : null;
}
