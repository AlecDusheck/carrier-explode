<script lang="ts">
  import { getBundle } from "#lib/api/bundles.remote.ts";
  import { verArgs, versionHref } from "#lib/format.ts";
  import { isPri } from "#lib/phones.ts";
  import type { At } from "#lib/types.ts";
  import TabLinks from "../../TabLinks.svelte";

  /** An Apple bundle's tabs: which there are depends on what this version holds. */
  let { at, tab }: { at: At; tab: string } = $props();

  const bundle = $derived(await getBundle(verArgs(at)));
  const plist = $derived(bundle.quick["carrier.plist"]);
  const items = $derived(
    [
      ["", "Overview", true],
      ["alerts", "Emergency alerts", at.ref.kind === "country" && typeof plist === "object" && plist !== null && "CellBroadcast" in plist],
      ["settings", "Settings", plist !== undefined],
      ["modem", "Modem", at.ref.kind === "carrier" || bundle.info.files.some(isPri)],
      ["files", `Files (${bundle.info.files.length})`, true],
      ["changes", "Changes", bundle.previous !== null],
    ] as const,
  );
</script>

<TabLinks
  items={items.filter(([, , shown]) => shown).map(([seg, label]): [string, string] => [versionHref(at, seg), label])}
  current={versionHref(at, tab)}
/>
