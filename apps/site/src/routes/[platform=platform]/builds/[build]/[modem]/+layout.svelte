<script lang="ts">
  import { page } from "$app/state";
  import { RELEASE_VIEWS } from "#lib/components/views.ts";
  import { MODEM_TABS } from "../../../../../params.ts";

  let { params, data, children } = $props();

  const Head = $derived(RELEASE_VIEWS[data.platform].modem.Head);
</script>

<div class="view">
  <Head build={params.build} modem={params.modem} tab={MODEM_TABS.find((t) => t === page.params.tab) ?? ""} />
  {@render children()}
</div>
