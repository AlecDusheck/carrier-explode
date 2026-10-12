<script lang="ts">
  import { modemTabView } from "#lib/components/views.ts";

  let { params, data } = $props();

  // The load function has turned away a tab the platform does not have.
  const load = $derived(modemTabView(data.platform, params.tab)?.body);
  const Body = $derived(load && (await load()).default);
</script>

{#if Body}<Body platform={data.platform} build={params.build} modem={params.modem} path={params.path} />{/if}
