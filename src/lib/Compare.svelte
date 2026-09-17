<script lang="ts">
  import { api, shortValue, type BundleRef, type DiffPayload, type IndexPayload } from "./api.ts";
  import { resource } from "./state.svelte.ts";

  let { index }: { index: IndexPayload } = $props();

  let leftName = $state("");
  let rightName = $state(sessionStorage.getItem("compare.right") ?? "");
  let path = $state("carrier.plist");
  let result = $state.raw<DiffPayload | null>(null);
  let error = $state<string | null>(null);
  let busy = $state(false);

  const names = $derived(index.carriers.map((c) => c.name));

  const left = resource(() => (leftName ? api.carrier(leftName) : null));
  const right = resource(() => (rightName ? api.carrier(rightName) : null));
  // The manifest publishes one file under several iOS keys; the pickers want one option per URL.
  const byUrl = (refs: BundleRef[]) => refs.filter((r, i) => refs.findIndex((x) => x.url === r.url) === i);
  const leftRefs = $derived(byUrl(left.value?.refs ?? []));
  const rightRefs = $derived(byUrl(right.value?.refs ?? []));
  let a = $derived(leftRefs[0]?.url ?? "");
  let b = $derived(rightRefs[0]?.url ?? "");

  const shared = $derived.by(() => {
    const r = result;
    return r ? r.aFiles.filter((f) => r.bFiles.includes(f)) : [];
  });

  function run() {
    if (!a || !b) return;
    busy = true;
    error = null;
    result = null;
    api.diff(a, b, path)
      .then((r) => (result = r))
      .catch((e) => (error = String(e.message ?? e)))
      .finally(() => (busy = false));
  }

  const refLabel = (r: BundleRef) => (r.os === "legacy" ? "legacy" : "iOS " + r.os) + " build " + r.build;
</script>

<div class="scroll pad">
  <h2 style="margin-top:0">Compare two bundles</h2>
  <p class="lead dimtext">
    The same carrier across two iOS versions, or two carriers in the same country. The comparison runs on
    the decoded file, so it works on carrier.plist, on a per-device override plist, and on a decoded
    baseband PRI.
  </p>

  <fieldset class="hgroup">
    <legend>Left</legend>
    <div class="rowflex">
      <select bind:value={leftName}>
        <option value="">carrier</option>
        {#each names as n (n)}<option value={n}>{n}</option>{/each}
      </select>
      <select bind:value={a} disabled={!leftRefs.length}>
        {#each leftRefs as r (r.url)}<option value={r.url}>{refLabel(r)}</option>{/each}
      </select>
    </div>
  </fieldset>

  <fieldset class="hgroup">
    <legend>Right</legend>
    <div class="rowflex">
      <select bind:value={rightName}>
        <option value="">carrier</option>
        {#each names as n (n)}<option value={n}>{n}</option>{/each}
      </select>
      <select bind:value={b} disabled={!rightRefs.length}>
        {#each rightRefs as r (r.url)}<option value={r.url}>{refLabel(r)}</option>{/each}
      </select>
    </div>
  </fieldset>

  <div class="rowflex">
    <label class="lbl">
      File
      <input type="text" bind:value={path} style="min-width:220px" />
    </label>
    <button class="btn" onclick={run} disabled={!a || !b || busy}>{busy ? "Comparing" : "Compare"}</button>
  </div>

  {#if shared.length}
    <p class="dimtext" style="font-size:11px">
      Present in both:
      {#each shared.slice(0, 40) as f (f)}
        <button class="chip" onclick={() => (path = f)}>{f}</button>
      {/each}
    </p>
  {/if}

  {#if error}<div class="banner err">{error}</div>{/if}

  {#if result}
    <fieldset class="hgroup">
      <legend>{result.counts.changed} changed, {result.counts.added} added, {result.counts.removed} removed</legend>
      {#if result.rows.length === 0}
        <p class="dimtext">Identical.</p>
      {:else}
        <table class="grid">
          <thead><tr><th>Key path</th><th>Left</th><th>Right</th></tr></thead>
          <tbody>
            {#each result.rows as r, i (i)}
              <tr>
                <td class="mono k wrap">
                  {r.path}
                  <span class="chip {r.kind === 'added' ? 'good' : r.kind === 'removed' ? 'bad' : 'warn'}">{r.kind}</span>
                </td>
                <td class="mono wrap">{shortValue(r.a, 300)}</td>
                <td class="mono wrap">{shortValue(r.b, 300)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </fieldset>
  {/if}
</div>
