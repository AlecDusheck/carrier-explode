/** The visitor's device as their browser describes it. */

import * as v from "valibot";
import type { Platform } from "@carrier-explode/schema/types";

export interface Device {
  readonly platform: Platform | null;
  readonly model: string | undefined;
}

/** The platform and phone model a user agent names; Chrome's says "K" for the model and Apple's never names it, so a hinted model wins. */
export function deviceOf(userAgent: string, hintedModel?: string): Device {
  const platform = /Android/.test(userAgent) ? "android"
    : /iPad/.test(userAgent) ? "ipados"
    : /iPhone|iPod/.test(userAgent) ? "ios"
    : null;
  // Chromium on a desktop hints an empty model.
  const model = hintedModel || userAgent.match(/Android [^;)]*; ([^;)]+?)(?: Build\/|;|\))/)?.[1];
  return { platform, model };
}

const UserAgentData = v.object({ getHighEntropyValues: v.function() });
const ModelHint = v.object({ model: v.string() });

/** The model Chromium reports when asked; other browsers have no userAgentData. */
async function hintedModel(): Promise<string | undefined> {
  const data = "userAgentData" in navigator ? navigator.userAgentData : undefined;
  const api = v.safeParse(UserAgentData, data);
  if (!api.success) return undefined;
  return v.parse(ModelHint, await api.output.getHighEntropyValues.call(data, ["model"])).model;
}

/** This browser's device. */
export const browserDevice = async (): Promise<Device> => deviceOf(navigator.userAgent, await hintedModel());
