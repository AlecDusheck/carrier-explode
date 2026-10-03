/** Per-platform pictures: the OS version mark beside a version, and a phone's drawing. */

import type { Component } from "svelte";
import type { Platform } from "#lib/schema/types.ts";
import IosIcon from "./ios/IosIcon.svelte";
import AndroidIcon from "./android/AndroidIcon.svelte";
import PhoneImage from "./ios/PhoneImage.svelte";
import PixelImage from "./android/PixelImage.svelte";

export const VERSION_ICONS = {
  ios: IosIcon,
  ipados: IosIcon,
  watchos: IosIcon,
  android: AndroidIcon,
} as const satisfies Record<Platform, Component<{ version?: string | undefined }>>;

/** A phone's drawing, by its id (product type or codename) and name. */
export const PHONE_IMAGES = {
  ios: PhoneImage,
  ipados: PhoneImage,
  watchos: PhoneImage,
  android: PixelImage,
} as const satisfies Record<Platform, Component<{ id?: string | undefined; name?: string | undefined }>>;
