<script lang="ts">
  import { atOf } from "#lib/at.ts";
  import { VIEWS } from "#lib/components/views.ts";
  import Pane from "#lib/components/Pane.svelte";

  let { params } = $props();

  const Overview = $derived(VIEWS[params.platform].Overview);
  const at = $derived(atOf(params));
</script>

<div class="scroll pad">
  <Pane><Overview {at} path="" /></Pane>
</div>
