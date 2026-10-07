<script lang="ts">
  import { versionHref } from "#lib/format.ts";
  import type { At } from "#lib/types.ts";
  import { TABS } from "../../params.ts";
  import TabLinks from "./TabLinks.svelte";
  import { VIEWS } from "./views.ts";

  /** A version's tab row: the Overview, then each of its platform's tabs this version has something for. */
  let { at }: { at: At } = $props();

  const view = $derived(VIEWS[at.ref.platform]);
  const holds = $derived(await view.holds(at));
  const items = $derived<Array<[string, string]>>([
    [versionHref(at), "Overview"],
    ...TABS.flatMap((seg): Array<[string, string]> => {
      const [t, held] = [view.tabs[seg], holds[seg]];
      if (t === undefined || held === undefined || held === false) return [];
      return [[versionHref(at, seg), typeof held === "number" ? `${t.label} (${held})` : t.label]];
    }),
  ]);
</script>

<TabLinks {items} />
