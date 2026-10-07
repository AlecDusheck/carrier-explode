<script lang="ts">
  import { getAndroidApns } from "#lib/api/android.remote.ts";
  import { verArgs } from "#lib/format.ts";
  import type { TabProps } from "#lib/types.ts";
  import Apns from "../Apns.svelte";

  let { at }: TabProps = $props();
</script>

<Apns {at} apns={await getAndroidApns(verArgs(at))} file="" />
