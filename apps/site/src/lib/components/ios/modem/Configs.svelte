<script lang="ts">
  import { getBaseband } from "#lib/api/apple.remote.ts";
  import type { ModemProps } from "../../views.ts";
  import Pane from "../../Pane.svelte";
  import PackageConfigs from "../baseband/PackageConfigs.svelte";

  let { build, modem }: ModemProps = $props();
</script>

<div class="scroll pad">
  <Pane>
    <PackageConfigs bb={await getBaseband({ build, family: modem })} />
  </Pane>
</div>
