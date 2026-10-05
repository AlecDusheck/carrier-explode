<script lang="ts">
  import { RELEASE_VIEWS } from "#lib/components/views.ts";

  let { params, data } = $props();

  const Overview = $derived(RELEASE_VIEWS[data.platform].modem.Overview);
</script>

<Overview build={params.build} modem={params.modem} />
