/**
 * Photos of iPhone models, from Wikimedia Commons under free licences (see
 * /credits), as static/phones/<slug>.webp. Keyed by the marketing name the
 * device table uses; a model without one gets a drawn outline instead.
 */

const PHOTOS = {
} as const satisfies Record<string, string>;

export type PhoneSlug = (typeof PHOTOS)[keyof typeof PHOTOS];

/** The photo for a phone by its marketing name ("iPhone 16 Pro"), or undefined. */
export function phoneImage(name: string | undefined): PhoneSlug | undefined {
  if (!name) return undefined;
  // A regional variant looks like the model it is a variant of: "iPhone 18 Pro Max (US)".
  const model = name.replace(/ \((US|China)\)$/, "");
  return Object.hasOwn(PHOTOS, model) ? PHOTOS[model as keyof typeof PHOTOS] : undefined;
}
