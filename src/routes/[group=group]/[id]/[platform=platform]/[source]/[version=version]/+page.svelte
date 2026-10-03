<script lang="ts">
  import { refOf } from "#lib/places.ts";
  import { sourceKey } from "#lib/schema/types.ts";
  import { VIEWS } from "#lib/components/views.ts";
  import Pane from "#lib/components/Pane.svelte";

  let { params } = $props();

  const ref = $derived(refOf(params.group, params.platform, params.source));
  const at = $derived({ place: { group: params.group, id: params.id }, ref, source: sourceKey(ref), version: params.version });
  const Overview = $derived(VIEWS[params.platform].tabs[""].body);
</script>

<div class="scroll pad">
  <Pane><Overview {at} path="" /></Pane>
</div>
