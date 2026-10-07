<!-- How many entries one of the manifest's tables has right now. -->
<script lang="ts">
  import { getManifestCounts } from "#lib/api/apple.remote.ts";
  import Live from "./Live.svelte";

  let { table }: { table: string } = $props();
</script>

<Live>{(await getManifestCounts())[table] ?? "—"}</Live>
