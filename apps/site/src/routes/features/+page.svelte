<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { countryName } from "@carrier-explode/schema";
  import { getVisitorCountry } from "#lib/api/sources.remote.ts";
  import {
    phoneRules,
    PRESETS,
    presetOf,
    presetRequirements,
    readRequirements,
    requirementParams,
    type Requirement,
    type Rule,
    type RuleId,
  } from "#lib/feature-matrix.ts";
  import { featurePage } from "#lib/feature-pages.ts";
  import { link, withParams } from "#lib/format.ts";
  import FeaturePhonePicker from "#lib/components/features/FeaturePhonePicker.svelte";
  import CarrierTree from "#lib/components/matrix/CarrierTree.svelte";
  import { MARKDOWN_PATH } from "#lib/components/matrix/markdown.ts";
  import MatrixCanvas from "#lib/components/matrix/MatrixCanvas.svelte";
  import RequirementsPanel from "#lib/components/matrix/RequirementsPanel.svelte";
  import { score, type Scored } from "#lib/components/matrix/score.ts";
  import {
    meetsAll,
    MISSES,
    NO_PHONE,
    noneShown,
    pickedRules,
    readMiss,
    searched,
    showsEverything,
    shownColumns,
    tally,
    withinMisses,
  } from "#lib/components/matrix/view.ts";

  let { data } = $props();

  const matrix = $derived(data.matrix);
  const rules = $derived(matrix ? phoneRules(matrix.columns) : []);
  const reqs = $derived(readRequirements(page.url.searchParams));
  const picked = $derived(pickedRules(rules, reqs));
  const miss = $derived(readMiss(page.url.searchParams));
  const everything = $derived(showsEverything(page.url.searchParams, picked));

  const preset = $derived(presetOf(reqs));
  const scored = $derived(matrix ? score(matrix.rows, matrix.columns, rules, reqs, (cc) => countryName(cc) ?? cc) : []);

  // The search the URL names; with none, the visitor's country once known, read after the page has drawn so the
  // server's page reads no visitor and the edge can keep it.
  const named = page.url.searchParams.get("q");
  let find = $state(named ?? "");
  $effect(() => {
    if (named !== null) return;
    void (async () => {
      const cc = await getVisitorCountry();
      if (find === "" && cc !== null && matrix?.rows.some((r) => r.entry.cc === cc)) find = countryName(cc) ?? "";
    })();
  });
  // The count follows the search: the carriers found, and of them those meeting every requirement.
  const found = $derived(searched(scored, find));
  const meets = $derived(found.filter(meetsAll).length);
  const shown = $derived(withinMisses(found, miss));
  const columns = $derived(shownColumns(rules, picked, everything));
  const markdown = $derived(link(MARKDOWN_PATH) + page.url.search);

  // The URL holds the requirements, so a list of them is a link. Shallow routing would change the address but not
  // `page.url`, which they are read from; the load reads only `phone`, so this reruns nothing.
  const set = (changes: Record<string, string | null>) =>
    goto(withParams(page.url, changes), { replace: true, reset: false });
  const change = (id: RuleId, req: Requirement) => set(requirementParams(new Map(reqs).set(id, req)));

  // A column reading a feature leads to that feature's page, for the same phone.
  const featureHref = (rule: Rule): string | null => {
    const slug = rule.reads[0];
    return matrix && featurePage(slug) ? `${link(`/features/${slug}`)}?${new URLSearchParams({ phone: matrix.phone.code })}` : null;
  };

  // On a phone the requirements are a page of their own, as the carrier list is on the source pages.
  let browsing = $state(false);
  let open: Scored | null = $state(null);
  // The panel follows the carrier through requirement changes, by key.
  const opened = $derived(open === null ? null : (scored.find((s) => s.row.entry.key === open?.row.entry.key) ?? null));
</script>

<svelte:head><link rel="alternate" type="text/markdown" href={markdown} /></svelte:head>

<a class="sr-only" href={markdown} tabindex="-1">This table as Markdown, with a link for each change</a>
<div class="split" class:browsing>
  <div class="pane-left">
    <div class="toolbar back">
      <button type="button" class="btn" onclick={() => (browsing = false)}>◀ Carriers</button>
      <span class="dimtext">{meets} of {found.length} meet them</span>
    </div>
    <div class="toolbar">
      <FeaturePhonePicker phones={data.phones} models={data.models} phone={matrix?.phone ?? null} />
    </div>
    <div class="scroll pad">
      <fieldset class="hgroup">
        <legend>Start from</legend>
        <select aria-label="Preset" value={preset ?? "custom"} onchange={(e) => {
          const chosen = PRESETS.find((p) => p.id === e.currentTarget.value);
          if (chosen) set({ ...requirementParams(presetRequirements(chosen)), all: null });
        }}>
          {#each PRESETS as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
          {#if preset === null}<option value="custom" disabled>Custom</option>{/if}
        </select>
      </fieldset>
      <RequirementsPanel {rules} {reqs} onchange={change} />
    </div>
    <div class="statusbar">
      <span class="cell grow">{picked.length ? `${picked.length} picked` : "None picked"}</span>
      {#if picked.length}<button type="button" class="cell" onclick={() => set({ ...requirementParams(new Map()), all: null })}>Clear</button>{/if}
    </div>
  </div>

  <div class="pane-right">
    {#if matrix}
      <div class="toolbar bar">
        <button type="button" class="btn show-reqs" onclick={() => (browsing = true)}>Requirements{picked.length ? ` (${picked.length})` : ""}</button>
        <input class="grow find" type="search" placeholder="Find a carrier or country" aria-label="Find a carrier or country" bind:value={find} onchange={() => set({ q: find || null })} />
        <select aria-label="Misses allowed" value={miss} onchange={(e) => set({ miss: e.currentTarget.value === "0" ? null : e.currentTarget.value })}>
          {#each MISSES as [value, label] (value)}<option {value}>{label}</option>{/each}
        </select>
      </div>
      <div class="stage">
        <MatrixCanvas rows={shown} {rules} {columns} {reqs} picked={picked.length} onpick={(s) => (open = s)} {featureHref} />
        {#if opened}<CarrierTree scored={opened} {rules} {reqs} onclose={() => (open = null)} />{/if}
        {#if !shown.length}
          <p class="banner empty">{noneShown(find)}</p>
        {/if}
      </div>
      <div class="statusbar">
        {#key meets}<span class="cell grow" class:pulse={picked.length > 0}>{tally(found, picked.length, find, matrix.phone.name)}</span>{/key}
        {#if picked.length}<button type="button" class="cell" onclick={() => set({ all: everything ? null : "1" })}>{everything ? "Picked columns" : "All columns"}</button>{/if}
      </div>
    {:else}
      <p class="pane-msg dimtext">{NO_PHONE}</p>
    {/if}
  </div>
</div>

<style>
  .bar {
    flex-wrap: nowrap;
  }
  .find {
    min-width: 0;
    flex: 1;
  }
  .stage {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .empty {
    position: absolute;
    top: 76px;
    left: 50%;
    width: min(360px, calc(100% - 32px));
    translate: -50% 0;
  }
  .show-reqs,
  .back {
    display: none;
  }
  /* A changed count flashes once, as a status line does when something new arrives. */
  .pulse {
    animation: pulse 700ms steps(4) 1;
  }
  @keyframes pulse {
    from {
      background: #fff1ad;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .pulse {
      animation: none;
    }
  }
  @media (max-width: 760px) {
    .show-reqs {
      display: inline-flex;
    }
    .back {
      display: flex;
      justify-content: space-between;
    }
    .pane-right :global(.statusbar) {
      padding-bottom: max(2px, env(safe-area-inset-bottom));
    }
  }
</style>
