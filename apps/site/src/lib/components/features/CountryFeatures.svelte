<script lang="ts">
  import { page } from "$app/state";
  import { RELEASE_PLATFORMS } from "@carrier-explode/schema/types";
  import { getCountryMatrix } from "#lib/api/sources.remote.ts";
  import { isSetting, type TreeConcept } from "#lib/feature-matrix.ts";
  import { link } from "#lib/format.ts";
  import type { ListEntry } from "#lib/server/lists.ts";
  import SourceIcon from "../SourceIcon.svelte";
  import SourceName from "../SourceName.svelte";
  import FeatureTree from "../matrix/FeatureTree.svelte";
  import ToneKey from "../matrix/ToneKey.svelte";
  import { TONE_WORDS } from "../matrix/score.ts";
  import { conceptTree, type ConceptFace, type FeatureNode } from "../matrix/tree.ts";

  /** A country's carriers by feature on the header's phone: each feature's line counts who gives it, and opens to them. */
  let { platform, iso }: { platform: string; iso: string } = $props();

  const release = $derived(RELEASE_PLATFORMS.find((p) => p === platform));
  const named = $derived(page.url.searchParams.get("phone") ?? undefined);
  const m = $derived(release === undefined ? null : await getCountryMatrix({ platform: release, iso, ...(named === undefined ? {} : { phone: named }) }));

  const SHARES = ["on", "available", "no", "unknown"] as const;
  type Share = (typeof SHARES)[number];
  const SHARE_TONE = { on: "met", available: "offered", no: "unmet", unknown: "blank" } as const satisfies Record<Share, keyof typeof TONE_WORDS>;

  const share = (cell: unknown): Share => (cell === "on" || cell === "available" || cell === "unknown" ? cell : "no");
  /** Per state concept, the carriers by what they give. */
  const givers = $derived(
    new Map<string, Readonly<Record<Share, readonly ListEntry[]>>>(
      (m?.columns ?? []).flatMap((id, i) => {
        if (isSetting(id)) return [];
        const by: Record<Share, ListEntry[]> = { on: [], available: [], no: [], unknown: [] };
        for (const r of m?.rows ?? []) by[share(r.cells[i])].push(r.entry);
        return [[id, by] as const];
      }),
    ),
  );

  const face = (id: TreeConcept): ConceptFace | undefined => {
    const g = givers.get(id);
    if (g === undefined) return undefined;
    const { on, available, no } = g;
    return { tone: on.length ? "met" : available.length ? "offered" : no.length ? "unmet" : "blank", words: "", href: null };
  };
  const total = $derived(m?.rows.length ?? 0);
  const twins = $derived(new Set((m?.rows ?? []).map((r) => r.entry.brand).filter((b, i, all) => all.indexOf(b) !== i)));
</script>

{#snippet count(n: FeatureNode)}
  {@const g = givers.get(n.id)}
  {#if g}
    <span class="counts">{[g.on.length ? `${g.on.length} on` : "", g.available.length ? `${g.available.length} off until turned on` : ""].filter(Boolean).join(" · ") || "none"}</span>
    <span class="bar" title="{g.on.length} on, {g.available.length} off until turned on, {g.no.length} not given, {g.unknown.length} no data">
      {#each SHARES as s (s)}{#if g[s].length}<i class="tone-{SHARE_TONE[s]}" style:flex={g[s].length}></i>{/if}{/each}
    </span>
  {/if}
{/snippet}

{#snippet carrierRows(entries: readonly { entry: ListEntry; words: string }[])}
  <div class="box">
    <ul class="list">
      {#each entries as { entry, words } (entry.key)}
        <li>
          <a href={link(entry.path)}>
            <SourceIcon picture={entry.picture} />
            <span class="name"><SourceName brand={entry.brand} code={entry.name} withCode={twins.has(entry.brand)} /></span>
            <span class="dim">{words}</span>
          </a>
        </li>
      {/each}
    </ul>
  </div>
{/snippet}

{#snippet who(n: FeatureNode)}
  {@const g = givers.get(n.id)}
  {#if g}
    {@render carrierRows([...g.on.map((entry) => ({ entry, words: TONE_WORDS.met })), ...g.available.map((entry) => ({ entry, words: TONE_WORDS.offered }))])}
  {/if}
{/snippet}

{#if m !== null && total}
  <fieldset class="hgroup" id="carriers">
    <legend>Carriers ({total})</legend>
    <FeatureTree groups={conceptTree(face)} tail={count} detail={who} opens={(n) => (givers.get(n.id)?.on.length ?? 0) + (givers.get(n.id)?.available.length ?? 0) > 0} />
    <details class="all">
      <summary>Every carrier</summary>
      {@render carrierRows(m.rows.map((r) => ({ entry: r.entry, words: "" })))}
    </details>
    <ToneKey tones={["met", "offered", "unmet", "blank"]} line />
  </fieldset>
{/if}

<style>
  .counts {
    flex: 1;
    min-width: 0;
    text-align: right;
    font-size: 11px;
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .bar {
    flex: none;
    display: flex;
    width: 56px;
    height: 9px;
    border: 1px solid;
    border-color: var(--shadow) var(--light) var(--light) var(--shadow);
    background: var(--field);
  }
  .bar i {
    background: var(--bg);
  }
  .bar i.tone-blank {
    background: none;
  }
  .box {
    max-height: 168px;
    overflow-y: auto;
    background: var(--field);
    border: 1px solid;
    border-color: var(--shadow) var(--light) var(--light) var(--shadow);
  }
  .box .list li > a {
    padding: 1px 6px;
  }
  .all {
    margin-top: 6px;
  }
  .all > summary {
    cursor: pointer;
    margin-bottom: 2px;
  }
</style>
