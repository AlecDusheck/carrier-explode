<!-- How many entries one of the manifest's tables has right now. -->
<script lang="ts">
  import { getManifestCounts } from "#lib/api/apple.remote.ts";

  let { table }: { table: string } = $props();

  const counts = $derived(await getManifestCounts());
</script>

{counts[table] ?? "?"}
