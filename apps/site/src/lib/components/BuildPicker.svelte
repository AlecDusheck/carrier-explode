<script lang="ts">
  import type { ReleaseSummary } from "@carrier-explode/schema/types";
  import { releaseLabel } from "#lib/naming.ts";
  import Picker from "./Picker.svelte";
  import VersionMark from "./VersionMark.svelte";

  /** Builds as a picker, each by its OS version and its id. */
  let { builds, current, href, label }: { builds: readonly ReleaseSummary[]; current: string; href: (b: ReleaseSummary) => string; label?: string } = $props();
</script>

<Picker {label} items={builds} selected={builds.find((b) => b.id === current)} key={(b) => b.id} {href}>
  {#snippet option(b)}
    <span class="picker-opt"><VersionMark platform={b.platform} version={b.version} /><span class="text">{releaseLabel(b)} ({b.id})</span></span>
  {/snippet}
</Picker>
