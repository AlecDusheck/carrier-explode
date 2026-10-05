<script lang="ts">
  import { asset } from "$app/paths";
  import { decoderFamily, type Platform } from "@carrier-explode/schema/types";
  import { DRAWING_NAMES, drawing } from "#lib/drawings.ts";
  import { PLATFORM_DRAWINGS } from "#lib/platforms.ts";

  /** A phone's drawing, by its id (product type or codename) or name as its family draws it; else the platform's outline. */
  let { platform, id, name }: { platform: Platform; id?: string | undefined; name?: string | undefined } = $props();

  const drawn = $derived(DRAWING_NAMES[decoderFamily(platform)]({ id, name }));
</script>

<img class="phone-img" src={(drawn === undefined ? undefined : drawing(drawn)) ?? asset(PLATFORM_DRAWINGS[platform])} alt="" width="20" height="20" />
