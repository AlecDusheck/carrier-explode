<script lang="ts">
  import IosIcon from "./IosIcon.svelte";
  import Picker from "./Picker.svelte";

  type Build = { build: string; version: string; families: string[] };

  /** The iOS images held, as a picker; images with no modem packages extracted are left out. */
  let { builds, current, href, label }: { builds: Build[]; current: string; href: (b: Build) => string; label?: string } = $props();
</script>

<Picker
  {label}
  items={builds.filter((b) => b.families.length || b.build === current)}
  selected={builds.find((b) => b.build === current)}
  key={(b) => b.build}
  {href}
>
  {#snippet option(b)}
    <span class="picker-opt"><IosIcon version={b.version} /><span class="text">iOS {b.version} ({b.build})</span></span>
  {/snippet}
</Picker>
