/**
 * The settings a phone runs with, as layers: carrier.plist, then the phone's
 * override plist, then (for an MVNO variant) an OverrideConfiguration. Merging
 * follows CommCenter (dictionaries combine key by key, anything else
 * replaces: see mergeSettings), and every value read remembers which layer it
 * came from, so a ConceptValue can name `overrides_V53_V54_V57.plist:IMSConfig...`
 * rather than a path that exists in no file.
 */

import { isJsonDict, mergeSettings } from "#lib/decode/index.ts";
import { toJson } from "../json.ts";
import type { NativeRef } from "../types.ts";

export interface Layer {
  /** Bundle member the values live in, e.g. `carrier.plist`. */
  readonly file: string;
  /** Path of the layer's root inside that file, `` or `MVNOOverrides.Configuration_1.OverrideConfiguration.`. */
  readonly prefix: string;
  readonly dict: Readonly<Record<string, unknown>>;
}

export interface Settings {
  readonly layers: readonly Layer[];
  /** All layers merged, lowest first. */
  readonly merged: Readonly<Record<string, unknown>>;
}

export function settings(layers: readonly Layer[]): Settings {
  const merged = layers.reduce<Record<string, unknown>>((acc, l) => mergeSettings(acc, { ...l.dict }), {});
  return { layers, merged };
}

/** A layer on top of `base`. */
export const withLayer = (base: Settings, layer: Layer): Settings => settings([...base.layers, layer]);

/**
 * Resolve a dotted path. Keys may contain dots themselves (`com.apple.voicemail.imap`),
 * so each step takes the longest run of segments that names a key at that level.
 */
function resolve(root: unknown, dotted: string): { value: unknown; found: boolean } {
  const parts = dotted.split(".");
  let cur = root;
  let i = 0;
  while (i < parts.length) {
    if (!isJsonDict(cur)) return { value: undefined, found: false };
    const dict = cur;
    let j = parts.length;
    while (j > i && !Object.hasOwn(dict, parts.slice(i, j).join("."))) j--;
    if (j === i) return { value: undefined, found: false };
    cur = dict[parts.slice(i, j).join(".")];
    i = j;
  }
  return { value: cur, found: true };
}

export interface Read {
  readonly value: unknown;
  readonly ref: NativeRef;
}

/** The topmost layer that sets `path`. */
export const origin = (s: Settings, path: string): Layer | undefined =>
  [...s.layers].reverse().find((l) => resolve(l.dict, path).found);

/** The merged value at `path` and where it was set, or undefined when no layer sets it. */
export function read(s: Settings, path: string): Read | undefined {
  const hit = resolve(s.merged, path);
  // The merged tree holds only what some layer set, so a found path always has an origin.
  const from = hit.found ? origin(s, path) : undefined;
  if (!from) return undefined;
  return { value: hit.value, ref: { path: `${from.file}:${from.prefix}${path}`, value: toJson(hit.value) ?? null } };
}
