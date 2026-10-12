<script lang="ts">
  import { atOf } from "#lib/at.ts";
  import { VIEWS } from "#lib/components/views.ts";
  import Pane from "#lib/components/Pane.svelte";

  let { params } = $props();

  const at = $derived(atOf(params));
</script>

<div class="scroll pad">
  <Pane awaiting={{ kind: "decode", name: at.ref.name }}>
    {@const Overview = (await VIEWS[params.platform].Overview()).default}
    <Overview {at} path="" />
  </Pane>
</div>
