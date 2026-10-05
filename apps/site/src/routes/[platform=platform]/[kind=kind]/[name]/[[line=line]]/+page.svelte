<script lang="ts">
  import { getSourceHead } from "#lib/api/sources.remote.ts";
  import { refOf, verOf } from "#lib/at.ts";
  import { VIEWS } from "#lib/components/views.ts";
  import Pane from "#lib/components/Pane.svelte";

  /** A source without a version: its default line's head, with the line picker where it has lines. */
  let { params } = $props();

  const Overview = $derived(VIEWS[params.platform].Overview);
</script>

<div class="scroll pad">
  <Pane>
    {@const h = await getSourceHead(verOf(params))}
    <Overview at={{ ref: refOf(params), line: h.line, version: h.entry.slug }} path="" />
  </Pane>
</div>
