<script lang="ts">
  import { getSourceHead } from "#lib/api/sources.remote.ts";
  import { headAt, verOf } from "#lib/at.ts";
  import { VIEWS } from "#lib/components/views.ts";
  import Pane from "#lib/components/Pane.svelte";

  /** A source without a version: its default line's head, with the line picker where it has lines. */
  let { params } = $props();
</script>

<div class="scroll pad">
  <Pane>
    {@const h = await getSourceHead(verOf(params))}
    {@const Overview = VIEWS[h.ref.platform].Overview}
    <Overview at={headAt(h)} path="" />
  </Pane>
</div>
