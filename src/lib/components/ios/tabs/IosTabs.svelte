<script lang="ts">
  import { getBundle } from "#lib/api/ios.remote.ts";
  import { nativeHref } from "#lib/format.ts";
  import { isPri } from "#lib/phones.ts";
  import type { NativeAt } from "#lib/types.ts";
  import TabLinks from "../../TabLinks.svelte";

  /** An iOS bundle's tabs: which there are depends on what this version holds. */
  interface Props {
    at: NativeAt;
    tab: string;
  }

  let { at, tab }: Props = $props();

  const bundle = $derived(await getBundle({ source: at.source, slug: at.version }));
  const plist = $derived(bundle.quick["carrier.plist"]);
  const alerts = $derived(at.ref.kind === "country" && typeof plist === "object" && plist !== null && "CellBroadcast" in plist);
  const modem = $derived(at.ref.kind === "carrier" || bundle.info.files.some(isPri));

  const items = $derived(
    [
      ["", "Overview", true],
      ["alerts", "Emergency alerts", alerts],
      ["settings", "Settings", plist !== undefined],
      ["modem", "Modem", modem],
      ["files", `Files (${bundle.info.files.length})`, true],
      ["changes", "Changes", bundle.previous !== null],
    ] as const,
  );
  const href = (seg: string): string => nativeHref(at.place, at.ref, at.version, seg || undefined);
</script>

<TabLinks items={items.filter(([, , shown]) => shown).map(([seg, label]) => [href(seg), label])} current={href(tab)} />
