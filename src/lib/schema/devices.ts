/** Pixel codenames by rank (generation × 10 + tier: Pro XL 4, Pro 3, base 2, Fold 1, a-series and tablet 0); unknown codenames rank last. */

const PIXELS = {
  sailfish: { name: "Pixel", rank: 12 }, marlin: { name: "Pixel XL", rank: 14 },
  walleye: { name: "Pixel 2", rank: 22 }, taimen: { name: "Pixel 2 XL", rank: 24 },
  blueline: { name: "Pixel 3", rank: 32 }, crosshatch: { name: "Pixel 3 XL", rank: 34 },
  sargo: { name: "Pixel 3a", rank: 30 }, bonito: { name: "Pixel 3a XL", rank: 30 },
  flame: { name: "Pixel 4", rank: 42 }, coral: { name: "Pixel 4 XL", rank: 44 },
  sunfish: { name: "Pixel 4a", rank: 40 }, bramble: { name: "Pixel 4a (5G)", rank: 40 },
  redfin: { name: "Pixel 5", rank: 52 }, barbet: { name: "Pixel 5a", rank: 50 },
  oriole: { name: "Pixel 6", rank: 62 }, raven: { name: "Pixel 6 Pro", rank: 63 }, bluejay: { name: "Pixel 6a", rank: 60 },
  panther: { name: "Pixel 7", rank: 72 }, cheetah: { name: "Pixel 7 Pro", rank: 73 }, lynx: { name: "Pixel 7a", rank: 70 },
  felix: { name: "Pixel Fold", rank: 71 }, tangorpro: { name: "Pixel Tablet", rank: 70 },
  shiba: { name: "Pixel 8", rank: 82 }, husky: { name: "Pixel 8 Pro", rank: 83 }, akita: { name: "Pixel 8a", rank: 80 },
  tokay: { name: "Pixel 9", rank: 92 }, caiman: { name: "Pixel 9 Pro", rank: 93 }, komodo: { name: "Pixel 9 Pro XL", rank: 94 },
  comet: { name: "Pixel 9 Pro Fold", rank: 91 }, tegu: { name: "Pixel 9a", rank: 90 },
  frankel: { name: "Pixel 10", rank: 102 }, blazer: { name: "Pixel 10 Pro", rank: 103 }, mustang: { name: "Pixel 10 Pro XL", rank: 104 },
  rango: { name: "Pixel 10 Pro Fold", rank: 101 },
} as const satisfies Readonly<Record<string, { readonly name: string; readonly rank: number }>>;

const BY_CODENAME: ReadonlyMap<string, { readonly name: string; readonly rank: number }> = new Map(Object.entries(PIXELS));

export const pixelRank = (codename: string): number => BY_CODENAME.get(codename)?.rank ?? -1;

/** "Pixel 9 Pro", or the codename itself when unknown. */
export const pixelName = (codename: string): string => BY_CODENAME.get(codename)?.name ?? codename;

/** Newest first; unknown codenames last, alphabetically. */
export const byPixelRank = (a: string, b: string): number => pixelRank(b) - pixelRank(a) || a.localeCompare(b);

/** The device a page means when none is named: the highest-ranked one. */
export const defaultDevice = (devices: readonly string[]): string | undefined => [...devices].sort(byPixelRank)[0];
