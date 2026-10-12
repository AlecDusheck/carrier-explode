<script lang="ts">
  import { getSamsungChanges } from "#lib/api/samsung.remote.ts";
  import type { TabProps } from "#lib/types.ts";
  import VersionChanges from "../VersionChanges.svelte";
  import SamsungDiff from "./SamsungDiff.svelte";

  let { at }: TabProps = $props();
</script>

<VersionChanges {at} changes={getSamsungChanges}>
  {#snippet diff(c)}<SamsungDiff changes={c} />{/snippet}
</VersionChanges>
