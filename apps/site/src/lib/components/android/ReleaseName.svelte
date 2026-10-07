<script lang="ts">
  import { releaseLabel } from "#lib/naming.ts";
  import type { ListedRelease } from "@carrier-explode/db";
  import VersionMark from "../VersionMark.svelte";

  let { release }: { release: ListedRelease } = $props();
</script>

<span class="picker-opt"><VersionMark platform={release.platform} version={release.version} />{releaseLabel(release)} <span class="mono dimtext">{release.id}</span></span>
