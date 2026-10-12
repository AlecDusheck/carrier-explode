<script lang="ts">
  import { getAndroidChanges } from "#lib/api/android.remote.ts";
  import type { TabProps } from "#lib/types.ts";
  import VersionChanges from "../VersionChanges.svelte";
  import AndroidDiff from "./AndroidDiff.svelte";

  let { at }: TabProps = $props();
</script>

<VersionChanges {at} changes={getAndroidChanges}>
  {#snippet diff(c)}<AndroidDiff changes={c} />{/snippet}
</VersionChanges>
