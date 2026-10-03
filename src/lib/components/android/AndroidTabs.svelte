<script lang="ts">
  import { getAndroid } from "#lib/api/android.remote.ts";
  import { verArgs, versionHref } from "#lib/format.ts";
  import type { At } from "#lib/types.ts";
  import TabLinks from "../TabLinks.svelte";

  /** An Android version's tabs, with the counts of what it holds. */
  let { at, tab }: { at: At; tab: string } = $props();

  const v = $derived(await getAndroid(verArgs(at)));
  const items = $derived(
    [
      ["", "Overview", true],
      ["settings", `Settings (${v.counts.configs})`, true],
      ["apns", `APNs (${v.counts.apns})`, true],
      ["files", "Files", true],
      ["changes", "Changes", v.previous !== null],
    ] as const,
  );
</script>

<TabLinks
  items={items.filter(([, , shown]) => shown).map(([seg, label]): [string, string] => [versionHref(at, seg), label])}
  current={versionHref(at, tab)}
/>
