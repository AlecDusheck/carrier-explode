<script lang="ts">
  import { page } from "$app/state";
  import { link } from "#lib/format.ts";
  import { PLATFORM_ORDER } from "#lib/platforms.ts";
  import { isPlatform, listPath } from "@carrier-explode/schema/types";

  // The platform the URL names, where it names one: an unknown Pixel carrier goes back to Pixel carriers.
  const named = $derived(page.url.pathname.split("/")[1] ?? "");
  const platform = $derived(isPlatform(named) ? named : PLATFORM_ORDER[0]);
</script>

<div class="view">
  <div class="scroll pad">
    <div class="banner err">{page.status} &middot; {page.error?.message}</div>
    <a class="btn" href={link(listPath(platform, "carrier"))}>Carriers</a>
  </div>
</div>
