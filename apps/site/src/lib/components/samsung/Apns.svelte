<script lang="ts">
  import { getSamsungApns } from "#lib/api/samsung.remote.ts";
  import { verArgs } from "#lib/format.ts";
  import { PACK_FILES } from "@carrier-explode/decode-samsung";
  import type { TabProps } from "#lib/types.ts";
  import Apns from "../Apns.svelte";

  let { at }: TabProps = $props();
</script>

<Apns {at} apns={await getSamsungApns(verArgs(at))} file={PACK_FILES.customer} />
