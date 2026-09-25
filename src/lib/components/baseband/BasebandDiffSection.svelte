<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { getBasebandDiff } from "$lib/api/tables.remote";
  import { withParams } from "$lib/format";
  import Pane from "../Pane.svelte";
  import BasebandDiff from "../BasebandDiff.svelte";
  import type { BasebandBuild } from "./types";

  let { build, family, others }: {
    build: string;
    family: string;
    /** Other images carrying a package of this family. */
    others: BasebandBuild[];
  } = $props();

  const vs = $derived(page.url.searchParams.get("vs"));
  const pick = (v: string) => goto(withParams(page.url, { vs: v || null }) + "#diff", { replaceState: true, keepFocus: true, noScroll: true });
</script>

<fieldset class="hgroup" id="diff">
  <legend>Diff: {family} in another image</legend>
  {#if others.length}
    <label class="lbl">
      Before
      <select name="vs" value={vs ?? ""} onchange={(e) => pick(e.currentTarget.value)}>
        <option value="">Pick an image</option>
        {#each others as b (b.build)}<option value={b.build}>iOS {b.version} ({b.build})</option>{/each}
      </select>
    </label>
    {#if vs}
      <Pane>
        {@const d = await getBasebandDiff({ a: vs, b: build, family })}
        <p class="dimtext note">
          iOS {d.a.version} ({d.a.build}) to iOS {d.b.version} ({d.b.build}):
          {d.counts.changed} changed, {d.counts.added} added, {d.counts.removed} removed.
        </p>
        <BasebandDiff parts={d.parts} />
      </Pane>
    {/if}
  {:else}
    <p class="dimtext">No other image has a {family} package yet.</p>
  {/if}
</fieldset>
