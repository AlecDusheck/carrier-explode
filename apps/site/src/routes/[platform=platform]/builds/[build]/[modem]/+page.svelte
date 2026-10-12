<script lang="ts">
  import { modemView } from "#lib/components/views.ts";

  let { params, data } = $props();

  const Overview = $derived((await modemView(data.platform).Overview()).default);
</script>

<Overview platform={data.platform} build={params.build} modem={params.modem} />
