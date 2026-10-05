/** The visitor's phone, read in the browser after a page has drawn, so no page reads the visitor on the server. */

import type { Platform } from "@carrier-explode/schema/types";
import { getPixelOfModel } from "#lib/api/sources.remote.ts";
import type { Phone } from "@carrier-explode/schema/types";
import { browserDevice } from "./device";

export interface VisitorDevice {
  readonly platform: Platform | null;
  /** The source line the visitor's phone is, when its platform names one by the model it reports. */
  readonly line: string | null;
}

const none = async (): Promise<null> => null;

/** An Apple device never says its model; a Pixel's reported model (`Pixel 9 Pro`) names its codename. */
const LINE_OF_MODEL = {
  ios: none,
  ipados: none,
  watchos: none,
  android: async (model) => getPixelOfModel(model),
} as const satisfies Record<Platform, (model: string) => Promise<string | null>>;

export async function visitorDevice(): Promise<VisitorDevice> {
  const { platform, model } = await browserDevice();
  return { platform, line: platform === null || model === undefined ? null : await LINE_OF_MODEL[platform](model) };
}

/** The visitor's own among the Features phones: a phone of theirs that names no line means its platform's newest. */
export const visitorPhone = (phones: readonly Phone[], { platform, line }: VisitorDevice): Phone | undefined =>
  phones.find((p) => p.code === line) ?? phones.find((p) => p.platform === platform);
