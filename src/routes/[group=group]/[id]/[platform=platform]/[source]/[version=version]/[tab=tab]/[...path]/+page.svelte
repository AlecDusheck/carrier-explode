<script lang="ts">
  import { error } from "@sveltejs/kit";
  import { refOf } from "#lib/places.ts";
  import { sourceKey } from "#lib/schema/types.ts";
  import { tabView } from "#lib/components/views.ts";
  import Pane from "#lib/components/Pane.svelte";

  let { params } = $props();

  const ref = $derived(refOf(params.group, params.platform, params.source));
  const at = $derived({ place: { group: params.group, id: params.id }, ref, source: sourceKey(ref), version: params.version });
  // The load function has already turned away a tab the platform does not have.
  const Body = $derived(tabView(params.platform, params.tab)?.body ?? error(404, `No ${params.tab} tab here.`));
</script>

<div class="scroll pad">
  <Pane><Body {at} path={params.path} /></Pane>
</div>
