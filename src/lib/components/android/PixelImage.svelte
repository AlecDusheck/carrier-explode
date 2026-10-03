<script lang="ts">
  import { asset } from "$app/paths";
  import { PIXELS } from "#lib/pixels.ts";

  /** A Pixel's drawing in static/phones, by codename; a plain outline for one the table does not know. */
  let { id }: { id?: string | undefined; name?: string | undefined } = $props();

  const slug = $derived(id === undefined ? undefined : PIXELS[id]?.slug);
</script>

<img class="phone-img" src={asset(slug ? `phones/pixel-${slug}.svg` : "phones/pixel.svg")} alt="" width="20" height="20" />
