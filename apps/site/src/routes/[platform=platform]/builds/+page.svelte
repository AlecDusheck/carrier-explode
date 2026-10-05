<script lang="ts">
  import { getBuilds } from "#lib/api/builds.remote.ts";
  import { buildsHref } from "#lib/format.ts";
  import { RELEASE_PLATFORMS } from "@carrier-explode/schema/types";
  import Pane from "#lib/components/Pane.svelte";
  import PlatformPicker from "#lib/components/PlatformPicker.svelte";
  import { buildTable } from "#lib/components/views.ts";

  let { data } = $props();
</script>

<div class="view">
  <div class="scroll pad">
    <div class="filters">
      <PlatformPicker platforms={RELEASE_PLATFORMS} selected={data.platform} href={(p) => buildsHref(p)} />
    </div>
    <Pane>
      {@const table = buildTable(data.platform, await getBuilds())}
      <table.View {...table.props} />
    </Pane>
  </div>
</div>
