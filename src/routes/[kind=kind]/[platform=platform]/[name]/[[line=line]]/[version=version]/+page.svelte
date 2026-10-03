<script lang="ts">
  import { refOf } from "#lib/at.ts";
  import { sourceKey } from "#lib/schema/types.ts";
  import { VIEWS } from "#lib/components/views.ts";
  import Pane from "#lib/components/Pane.svelte";

  let { params } = $props();

  const Overview = $derived(VIEWS[params.platform].tabs[""].body);
  const at = $derived({ ref: refOf(params), source: sourceKey(refOf(params)), line: params.line, version: params.version });
</script>

<div class="scroll pad">
  <Pane><Overview {at} path="" /></Pane>
</div>
