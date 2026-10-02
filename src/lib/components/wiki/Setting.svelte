<!-- One number about a setting across every current bundle, from the key-scan index:
     how many set it, or its median, largest or smallest value (with who holds it). -->
<script lang="ts">
  import { getSettingSummary } from "#lib/api/tables.remote.ts";
  import Holders from "./Holders.svelte";

  type Show = "set" | "scanned" | "median" | "max" | "min";
  let { path, show = "set", file = "carrier.plist", scope = "carriers" }: { path: string; show?: Show; file?: string; scope?: string } = $props();

  const s = $derived(await getSettingSummary({ path, file, scope }));
  const kind = $derived(scope === "countries" ? "countries" : "carriers");
  const extreme = $derived(show === "max" ? s.max : show === "min" ? s.min : null);
</script>

{#if show === "set"}{s.set}{:else if show === "scanned"}{s.scanned}{:else if show === "median"}{s.median ?? "-"}{:else if extreme}
  {extreme.value} (<Holders names={extreme.names} {kind} />)
{:else}-{/if}
