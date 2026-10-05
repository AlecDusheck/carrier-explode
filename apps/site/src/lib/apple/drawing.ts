/** An Apple device's drawing name from its model's name: "iPhone 18 Pro Max (US)" is drawn as the model it is a variant of. */
export const appleDrawingName = (name: string): string =>
  name.replace(/ \((US|China)\)$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-$/, "");
