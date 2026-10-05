<script lang="ts">
  import { modemTabView } from "#lib/components/views.ts";

  let { params, data } = $props();

  // The load function has turned away a tab the platform does not have.
  const Body = $derived(modemTabView(data.platform, params.tab)?.body);
</script>

{#if Body}<Body build={params.build} modem={params.modem} path={params.path} />{/if}
