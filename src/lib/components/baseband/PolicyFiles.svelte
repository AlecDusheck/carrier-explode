<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { getBasebandFile } from "$lib/api/tables.remote";
  import { humanBytes, withParams } from "$lib/format";
  import Pane from "../Pane.svelte";
  import PolicyTree from "../PolicyTree.svelte";
  import Variants from "../Variants.svelte";
  import type { Baseband } from "./types";

  let { id, files }: { id: string; files: Baseband["files"] } = $props();

  let raw = $state(false);
  const readable = $derived(files.filter((f) => f.readable));
  const fileAt = $derived(page.url.searchParams.get("file"));
  const close = () => goto(withParams(page.url, { file: null }), { replaceState: true, keepFocus: true, noScroll: true });
</script>

<fieldset class="hgroup" id="policy">
  <legend>Policy files ({readable.length})</legend>
  <p class="dimtext note">Plaintext EFS files the package writes. A repeated path has one copy per platform or config.</p>
  <div class="hscroll">
    <table class="grid">
      <thead><tr><th>Path</th><th>From</th><th>Serves</th></tr></thead>
      <tbody>
        {#each readable as f (f.i)}
          <tr class:sel={fileAt === String(f.i)}>
            <td class="wrap">
              <a class="mono" href="{withParams(page.url, { file: String(f.i) })}#file" data-sveltekit-noscroll data-sveltekit-replacestate>{f.path}</a>
              {#if f.refs?.policy}<span class="tag">{f.refs.policy}</span>{/if}
            </td>
            <td class="mono">{f.member}</td>
            <td><Variants variants={f.variants} configs={f.configs} /></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  {#if fileAt !== null}
    <div id="file" class="viewer">
      <Pane>
        {@const f = await getBasebandFile({ id, i: Number(fileAt) })}
        <div class="rowflex">
          <b class="mono wrap">{f.path}</b>
          <span class="dimtext">{f.format}, {f.member}, {humanBytes(f.length)}</span>
          <span class="grow"></span>
          {#if f.format === "xml"}
            <button class="btn" class:on={!raw} onclick={() => (raw = false)}>Rules</button>
            <button class="btn" class:on={raw} onclick={() => (raw = true)}>Raw</button>
          {/if}
          <button class="btn" onclick={close}>Close</button>
        </div>
        {#if f.refs?.carriers?.length || f.refs?.plmns?.length || f.refs?.mccs?.length}
          <div class="rowflex refs">
            {#each f.refs.carriers ?? [] as c, i (i)}<span class="chip">{c}</span>{/each}
            {#if f.refs.plmns?.length}<span class="dimtext">{f.refs.plmns.length} PLMNs</span>{/if}
            {#if f.refs.mccs?.length}<span class="dimtext">MCC {f.refs.mccs.join(" ")}</span>{/if}
          </div>
        {/if}
        {#if f.format === "xml" && !raw && f.text}
          <PolicyTree xml={f.text} />
        {:else if f.text !== undefined}
          <pre class="code">{f.text}</pre>
        {:else}
          <p class="dimtext">Binary content.</p>
        {/if}
      </Pane>
    </div>
  {/if}
</fieldset>

<style>
  .viewer { margin-top: 8px; scroll-margin-top: 8px; }
  .refs { margin: 4px 0; }
</style>
