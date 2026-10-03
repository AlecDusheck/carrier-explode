<script lang="ts">
  import { asset } from "$app/paths";

  /** Models with a drawing in static/phones (measured on Apple's images); others get a plain outline. */
  const PHONES = [
    "iphone-18-pro", "iphone-18-pro-max", "iphone-17-pro", "iphone-17-pro-max", "iphone-17", "iphone-17e", "iphone-air",
    "iphone-16-pro", "iphone-16-pro-max", "iphone-16-plus", "iphone-16", "iphone-16e", "iphone-15-pro", "iphone-15-pro-max",
    "iphone-15-plus", "iphone-15", "iphone-14-pro", "iphone-14-pro-max", "iphone-14-plus", "iphone-14",
    "iphone-se-3rd-generation", "iphone-se-2nd-generation", "iphone-13-pro", "iphone-13-pro-max", "iphone-13", "iphone-13-mini",
    "iphone-12-pro", "iphone-12-pro-max", "iphone-12", "iphone-12-mini", "iphone-11-pro", "iphone-11-pro-max", "iphone-11",
    "iphone-xs", "iphone-xs-max", "iphone-x", "iphone-xr", "iphone-8-plus", "iphone-8", "iphone-7-plus", "iphone-7",
    "iphone-6s", "iphone-6", "iphone-6s-plus", "iphone-6-plus", "iphone-5s", "iphone-se-1st-generation", "iphone-5",
    "iphone-5c", "iphone-4s", "iphone-4", "iphone-3gs",
  ] as const;

  let { name }: { id?: string | undefined; name?: string | undefined } = $props();

  // "iPhone 18 Pro Max (US)" looks like the model it is a variant of.
  const slug = $derived(PHONES.find((p) => p === name?.replace(/ \((US|China)\)$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-$/, "")));
</script>

<img class="phone-img" src={asset(slug ? `phones/${slug}.svg` : "phones/iphone.svg")} alt="" width="20" height="20" />
