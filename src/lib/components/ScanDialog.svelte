<script lang="ts">
  import { scanKey } from "$lib/api/tables.remote";
  import { bundleHref, shortValue } from "$lib/format";
  import { scan, copyText, type ScanScope } from "$lib/ui-state.svelte";
  import Pane from "./Pane.svelte";

  let mode = $state<"values" | "bundles">("values");
  let anyIndex = $state(false);

  const SCOPES: Array<[ScanScope, string]> = [
    ["countries", "Countries"],
    ["all", "All carriers"],
  ];

  const indexed = $derived(/\[\d+\]/.test(scan.path));
  const path = $derived(anyIndex ? scan.path.replace(/\[\d+\]/g, "[*]") : scan.path);
  const args = $derived({ path, file: scan.file, scope: scan.scope });
  const kind = $derived(scan.scope === "countries" ? "countries" : "carriers");
  const close = () => (scan.open = false);
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && close()} />

{#snippet bundleLink(name: string)}
  <a class="chip" href={bundleHref(kind, name)} onclick={close}>{name}</a>
{/snippet}

<div class="dialog-back" onclick={(e) => e.target === e.currentTarget && close()} role="presentation">
  <div class="dialog" role="dialog" aria-label="Setting across bundles">
    <div class="titlebar">
      <span>Setting across bundles</span>
      <span class="spacer"></span>
      <button class="btn" onclick={close}>Close</button>
    </div>

    <div class="toolbar">
      <span class="mono breakall">{path}</span>
      <span class="dimtext">in {scan.file}</span>
      <span class="grow"></span>
      {#if indexed}
        <label class="lbl">
          <input type="checkbox" name="any-index" bind:checked={anyIndex} />
          Match all indexes
        </label>
      {/if}
      <label class="lbl">
        Scope
        <select name="scope" bind:value={scan.scope}>
          {#if scan.scope.startsWith("country:")}
            <option value={scan.scope}>{scan.scope.slice(8).toUpperCase()} carriers</option>
          {/if}
          {#each SCOPES as [v, label] (v)}
            <option value={v}>{label}</option>
          {/each}
        </select>
      </label>
    </div>

    <div class="scroll pad">
      <!-- A scan can take a while; a fresh boundary per request shows the pending line instead of stale rows. -->
      {#key args}
        <Pane>
          {@const result = await scanKey(args)}
          <div class="filters">
            <button class="btn" class:on={mode === "values"} onclick={() => (mode = "values")}>
              Distinct values ({result.buckets.length})
            </button>
            <button class="btn" class:on={mode === "bundles"} onclick={() => (mode = "bundles")}>
              Per bundle ({result.hits.length})
            </button>
            <span class="grow"></span>
            <span class="dimtext">
              scanned {result.scanned}, set {result.set}
              {#if result.unindexed}, not yet indexed {result.unindexed}{/if}
            </span>
          </div>

          {#if mode === "values"}
            <table class="grid">
              <thead><tr><th class="num">Count</th><th>Value</th><th>Bundles</th></tr></thead>
              <tbody>
                {#each result.buckets as b, i (i)}
                  <tr>
                    <td class="num">{b.count}</td>
                    <td class="mono wrap">
                      {#if !b.present}<span class="dimtext">absent</span>{:else}{shortValue(b.value, 400)}{/if}
                    </td>
                    <td>
                      {#each b.carriers.slice(0, 14) as name (name)}{@render bundleLink(name)}{/each}
                      {#if b.count > 14}<span class="dimtext">+{b.count - 14} more</span>{/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {:else}
            <table class="grid">
              <thead><tr><th>Bundle</th><th>iOS</th><th>Build</th><th>Value</th></tr></thead>
              <tbody>
                {#each result.hits as h (h.name)}
                  <tr>
                    <td class="k">{@render bundleLink(h.name)}</td>
                    <td class="mono">{h.os}</td>
                    <td class="mono">{h.build}</td>
                    <td class="mono wrap">
                      {#if h.unindexed}<span class="dimtext">not yet indexed</span>
                      {:else if h.missing}<span class="dimtext">no {result.file}</span>
                      {:else if !h.matches.length}<span class="dimtext">absent</span>
                      {:else if h.matches.length === 1 && h.matches[0].path === result.path}
                        {shortValue(h.matches[0].value, 300)}
                      {:else}
                        {#each h.matches as m (m.path)}
                          <div><span class="dimtext">{m.path}</span> {shortValue(m.value, 300)}</div>
                        {/each}
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}

          <div class="rowflex gap-above">
            <button class="btn" onclick={() => copyText(JSON.stringify(result, null, 2))}>Copy JSON</button>
          </div>
        </Pane>
      {/key}
    </div>
  </div>
</div>
