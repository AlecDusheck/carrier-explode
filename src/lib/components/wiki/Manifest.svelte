<!-- How many entries one of the manifest's tables has right now. -->
<script lang="ts">
  import { getManifestFacts } from "#lib/api/bundles.remote.ts";

  let { table }: { table: string } = $props();

  const facts = $derived(await getManifestFacts());
</script>

{facts.counts[table] ?? "?"}
