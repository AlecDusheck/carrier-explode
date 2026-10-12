<script lang="ts">
  import { atOf } from "#lib/at.ts";
  import { tabView } from "#lib/components/views.ts";
  import Pane from "#lib/components/Pane.svelte";

  let { params } = $props();

  // The load function has turned away a tab the platform does not have.
  const body = $derived(tabView(params.platform, params.tab)?.body);
  const at = $derived(atOf(params));
</script>

<div class="scroll pad">
  {#if body}
    <Pane awaiting={{ kind: "decode", name: params.path.split("/").pop() || at.ref.name }}>
      {@const Body = (await body()).default}
      <Body {at} path={params.path} />
    </Pane>
  {/if}
</div>
