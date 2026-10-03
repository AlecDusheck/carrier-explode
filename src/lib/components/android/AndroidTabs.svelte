<script lang="ts">
  import { getAndroid } from "#lib/api/android.remote.ts";
  import { nativeHref } from "#lib/format.ts";
  import type { NativeAt } from "#lib/types.ts";
  import TabLinks from "../TabLinks.svelte";

  /** An Android source's tabs, with the counts of what this version holds. */
  interface Props {
    at: NativeAt;
    tab: string;
  }

  let { at, tab }: Props = $props();

  const v = $derived(await getAndroid({ source: at.source, slug: at.version }));
  const href = (seg: string): string => nativeHref(at.place, at.ref, at.version, seg || undefined);
  const items = $derived(
    [
      ["", "Overview", true],
      ["settings", `Settings (${v.counts.configs})`, true],
      ["apns", `APNs (${v.counts.apns})`, true],
      ["raw", "Raw", true],
      ["changes", "Changes", v.previous !== null],
    ] as const,
  );
</script>

<TabLinks items={items.filter(([, , shown]) => shown).map(([seg, label]): [string, string] => [href(seg), label])} current={href(tab)} />
