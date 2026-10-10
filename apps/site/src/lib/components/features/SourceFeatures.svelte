<script lang="ts">
  import { getSourceFeatures } from "#lib/api/sources.remote.ts";
  import type { MatrixCell, TreeConcept } from "#lib/feature-matrix.ts";
  import { verArgs, versionHref } from "#lib/format.ts";
  import { keyPathFilter } from "#lib/settings.ts";
  import type { At } from "#lib/types.ts";
  import type { Tab } from "../../../params.ts";
  import FeatureTree from "../matrix/FeatureTree.svelte";
  import ToneKey from "../matrix/ToneKey.svelte";
  import { cellWords } from "../matrix/score.ts";
  import { cellTone, conceptTree, type ConceptFace } from "../matrix/tree.ts";

  interface Props {
    at: At;
    phones: readonly string[];
    /** The Apple override file the phones read, as `?file=` names it. */
    file: string | null;
    /** The tab that shows a native key (`file:path`): most are Settings', some another tab's, like the APNs. */
    tabOf: (key: string) => Tab;
  }

  /** What a source's head gives the phones the page shows it for, as a feature tree; each line opens the settings it is read from. */
  let { at, phones, file, tabOf }: Props = $props();

  const f = $derived(await getSourceFeatures({ ...verArgs(at), phones: [...phones], file }));
  const cells = $derived(new Map(f.state === "judged" ? f.cells : []));

  /** The tab holding the concept's first key, filtered to every key it is read from there. */
  function href(id: TreeConcept): string | null {
    const keys = f.state === "judged" ? (f.keys[id] ?? []) : [];
    const first = keys[0];
    if (first === undefined) return null;
    const tab = tabOf(first);
    const paths = keys.filter((k) => tabOf(k) === tab).map((k) => k.slice(k.indexOf(":") + 1));
    // Settings filters its trees; another tab, like the APNs', is short enough to read whole.
    const query = new URLSearchParams(tab === "settings" ? { filter: keyPathFilter(paths) } : {});
    if (file !== null) query.set("file", file);
    return `${versionHref(at, tab)}${query.size ? `?${query}` : ""}`;
  }

  const face = (id: TreeConcept): ConceptFace | undefined => {
    const cell: MatrixCell | undefined = cells.get(id);
    return cell === undefined ? undefined : { tone: cellTone(cell), words: cellWords(cell), href: href(id) };
  };
</script>

{#if f.state === "judged" && f.cells.length}
  <fieldset class="hgroup">
    <legend>Features</legend>
    <FeatureTree groups={conceptTree(face)} />
    {#if f.phone !== null}
      <ToneKey tones={["met", "offered", "unmet", "blank"]} line />
    {/if}
  </fieldset>
{/if}
