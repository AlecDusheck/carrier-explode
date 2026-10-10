<script lang="ts">
  import { getModemItems } from "#lib/api/modem.remote.ts";
  import type { ModemConfigRef } from "#lib/api/schemas.ts";
  import { treeKeys } from "#lib/keys.ts";
  import { sectionRuns, type SectionCount } from "#lib/modem.ts";
  import ShowMore from "../ShowMore.svelte";
  import ItemLine from "./ItemLine.svelte";

  /** A configuration's settings that match a filter, in one section or all, a page at a time; each section headed where it starts. */
  let { ref, filter, section, sections }: {
    ref: ModemConfigRef;
    filter: string;
    section: string | null;
    sections: readonly SectionCount[];
  } = $props();

  // Where each drawn page starts; its parent starts it over for a new filter or section.
  const starts = $state([0]);
  const pageAt = (from: number) => getModemItems({ ref, filter, section, from });
  const count = (title: string): number => sections.find((s) => s.title === title)?.count ?? 0;
  const total = $derived(section === null ? sections.reduce((n, s) => n + s.count, 0) : count(section));
  const last = $derived(await pageAt(starts.at(-1) ?? 0));
  const more = (): void => {
    // A click while the last page loads would ask for it again.
    if (last.next !== null && !starts.includes(last.next)) starts.push(last.next);
  };
</script>

{#each starts as from (from)}
  {@const p = await pageAt(from)}
  {@const items = [...p.items.map((x) => x.item), ...p.related]}
  {#each sectionRuns(p) as run (run.section)}
    {#if run.heads}<h3 class="mono">{run.section} <span class="dimtext">({count(run.section)})</span></h3>{/if}
    <div class="tree" {@attach treeKeys}>
      {#each run.items as x (x)}<ItemLine item={x.item} {items} section={x.section} errors={x.errors} />{/each}
    </div>
  {/each}
{/each}
<ShowMore shown={last.next ?? total} {total} {more} />
