<script lang="ts">
  import { refOf } from "#lib/at.ts";
  import { sourceKey } from "#lib/schema/types.ts";
  import { VIEWS } from "#lib/components/views.ts";
  import Pane from "#lib/components/Pane.svelte";

  let { params } = $props();

  // The load function has turned away a tab the platform does not have.
  const Body = $derived(VIEWS[params.platform].tabs[params.tab]?.body);
  const at = $derived({ ref: refOf(params), source: sourceKey(refOf(params)), line: params.line, version: params.version });
</script>

<div class="scroll pad">
  {#if Body}<Pane><Body {at} path={params.path} /></Pane>{/if}
</div>
