<script lang="ts">
  import { getBundleHead } from "#lib/api/bundles.remote.ts";
  import { refOf, verOf } from "#lib/at.ts";
  import { sourceKey } from "#lib/schema/types.ts";
  import { VIEWS } from "#lib/components/views.ts";
  import Pane from "#lib/components/Pane.svelte";

  /** A source without a version: its default line's head, with the line picker where it has lines. */
  let { params } = $props();

  const Overview = $derived(VIEWS[params.platform].tabs[""].body);
</script>

<div class="scroll pad">
  <Pane>
    {@const h = await getBundleHead(verOf(params))}
    <Overview at={{ ref: refOf(params), source: sourceKey(refOf(params)), line: h.line, version: h.entry.slug }} path="" />
  </Pane>
</div>
