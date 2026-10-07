<script lang="ts">
  import { modemView } from "#lib/components/views.ts";
  import { MODEM_TABS } from "../../../../../params.ts";

  let { params, data, children } = $props();

  const Head = $derived(modemView(data.platform).Head);
</script>

<div class="view">
  <Head platform={data.platform} build={params.build} modem={params.modem} tab={MODEM_TABS.find((t) => t === params.tab) ?? ""} />
  {@render children()}
</div>
