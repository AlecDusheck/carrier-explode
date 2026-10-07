<script lang="ts">
  import { getList } from "#lib/api/sources.remote.ts";
  import { SOURCE_NOUNS } from "#lib/platforms.ts";
  import { decoderFamily, SEGMENT_KIND } from "@carrier-explode/schema/types";
  import Pane from "#lib/components/Pane.svelte";

  let { params } = $props();
</script>

<div class="scroll pad">
  <Pane quiet>
    {#if (await getList({ platform: params.platform, kind: SEGMENT_KIND[params.kind] })).length}
      <p class="dimtext note">Right-click a setting to compare it across {SOURCE_NOUNS[decoderFamily(params.platform)].many}.</p>
    {/if}
  </Pane>
</div>
