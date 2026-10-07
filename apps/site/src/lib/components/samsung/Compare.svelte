<script lang="ts">
  import type { NativeComparison } from "#lib/server/compare.ts";
  import SamsungDiff from "./SamsungDiff.svelte";

  /** Two Samsung packs key by key, as /compare shows them. */
  let { comparison }: { comparison: NativeComparison<"samsung"> } = $props();
</script>

<SamsungDiff changes={comparison} left="Left" right="Right" />
