<script lang="ts">
  import { releaseLabel } from "#lib/naming.ts";
  import type { ReleaseHeader } from "@carrier-explode/schema/types";
  import VersionMark from "../VersionMark.svelte";

  let { release }: { release: ReleaseHeader } = $props();
</script>

<span class="picker-opt"><VersionMark platform={release.platform} version={release.version} />{releaseLabel(release)} <span class="mono dimtext">{release.id}</span></span>
