<script lang="ts">
  import type { NativeComparison } from "#lib/server/compare.ts";
  import AndroidDiff from "./AndroidDiff.svelte";

  /** Two Android versions key by key, as /compare shows them. */
  let { comparison }: { comparison: NativeComparison<"android"> } = $props();
</script>

<AndroidDiff changes={comparison} left="Left" right="Right" />
