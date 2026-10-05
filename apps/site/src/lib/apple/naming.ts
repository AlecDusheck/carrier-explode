/** How an Apple version and an iOS image read: the images and OTA copies carrying a version, and the OS a build is. */

import type { EntryNaming, ReleaseNaming } from "#lib/naming.ts";

/** "27.2 beta 1–2" for betas of one release, else "26.6 – 26.6.2". */
function iosRange(first: string, last: string): string {
  const [a, b] = [/^(.+ beta)(?: (\d+))?$/.exec(first), /^(.+ beta) (\d+)$/.exec(last)];
  return a && b && a[1] === b[1] ? `${a[1]} ${a[2] ?? 1}–${b[2]}` : `${first} – ${last}`;
}

/** The images carrying it and the OS its OTA copy is published for, then the bundle's own version; the mark is the oldest image's OS, as v1 showed it. */
export const appleNaming = (os: string): EntryNaming => ({
  label: (e) => {
    const [first, last] = [e.images[0], e.images.at(-1)];
    const image = first === undefined || last === undefined ? [] : [`${os} ${first === last ? first : iosRange(first, last)} image`];
    const ota = e.ota.length ? [`OTA${e.ota[0] ? ` ${os} ${e.ota[0]}+` : ""}`] : [];
    return `${[...image, ...ota].join(" + ")} · build ${e.version}`;
  },
  icon: (e) => e.images[0] ?? e.ota[0],
});

/** An iOS image reads as its release label: `27.2 beta 2`. */
export const iosRelease: ReleaseNaming<"ios"> = { os: (r) => r.label, label: (r) => `iOS ${r.label}` };
