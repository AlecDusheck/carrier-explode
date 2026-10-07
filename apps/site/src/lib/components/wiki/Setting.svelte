<!-- One number about a setting across every current bundle, from the index's settings rows:
     how many set it, or its median, largest or smallest value (with who holds it). -->
<script lang="ts">
  import { getSettingSummary } from "#lib/api/scan.remote.ts";
  import Holders from "./Holders.svelte";
  import Live from "./Live.svelte";

  type Show = "set" | "scanned" | "median" | "max" | "min";
  let { path, show = "set", file = "carrier.plist", scope = "carriers" }: { path: string; show?: Show; file?: string; scope?: "carriers" | "countries" } = $props();
</script>

<Live>
  {@const s = await getSettingSummary({ platform: "ios", path, file, scope })}
  {@const extreme = show === "max" ? s.max : show === "min" ? s.min : null}
  {#if show === "set"}{s.set}{:else if show === "scanned"}{s.scanned}{:else if show === "median"}{s.median ?? "—"}{:else if extreme}
    {extreme.value} (<Holders sources={extreme.sources} />)
  {:else}—{/if}
</Live>
