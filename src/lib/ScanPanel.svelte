<script lang="ts">
  import { api, shortValue, type ScanResult } from "./api.ts";
  import { scan, router, copyText } from "./state.svelte.ts";

  let result = $state<ScanResult | null>(null);
  let error = $state<string | null>(null);
  let busy = $state(false);
  let mode = $state<"values" | "carriers">("values");
  let token = 0;

  const SCOPES: Array<[string, string]> = [
    ["countries", "Country bundles"],
    ["all", "All carriers"],
  ];

  $effect(() => {
    if (!scan.open || !scan.path) return;
    const path = scan.path, file = scan.file, scope = scan.scope, limit = scan.limit;
    const mine = ++token;
    busy = true;
    error = null;
    result = null;
    api.keyscan(path, scope, file, limit)
      .then((r) => { if (mine === token) result = r; })
      .catch((e) => { if (mine === token) error = String(e.message ?? e); })
      .finally(() => { if (mine === token) busy = false; });
  });

  const scopeLabel = $derived(
    scan.scope.startsWith("country:")
      ? scan.scope.slice(8).toUpperCase() + " carriers"
      : scan.scope === "countries" ? "Country bundles" : "All carriers",
  );

  function openCarrier(name: string) {
    scan.open = false;
    router.go(scan.scope === "countries" ? "countries" : "carriers", name);
  }
</script>

{#if scan.open}
  <div class="dialog-back" onclick={(e) => e.target === e.currentTarget && (scan.open = false)} role="presentation">
    <div class="dialog">
      <div class="titlebar">
        <span>Setting across bundles</span>
        <span class="spacer"></span>
        <button class="btn" onclick={() => (scan.open = false)}>Close</button>
      </div>

      <div class="toolbar">
        <span class="mono" style="word-break:break-all">{scan.path}</span>
        <span class="chip">{scan.file}</span>
        <span class="grow"></span>
        <label class="lbl">
          Scope
          <select bind:value={scan.scope}>
            {#if scan.scope.startsWith("country:")}
              <option value={scan.scope}>{scopeLabel}</option>
            {/if}
            {#each SCOPES as [v, label] (v)}
              <option value={v}>{label}</option>
            {/each}
          </select>
        </label>
        <label class="lbl">
          Limit
          <select bind:value={scan.limit}>
            {#each [20, 40, 60, 90, 120] as n (n)}<option value={n}>{n}</option>{/each}
          </select>
        </label>
      </div>

      <div class="scroll pad">
        {#if busy}
          <p class="dimtext">Downloading and decoding up to {scan.limit} bundles.</p>
        {:else if error}
          <div class="banner err">{error}</div>
        {:else if result}
          <div class="rowflex" style="margin-bottom:6px">
            <button class="btn" class:on={mode === "values"} onclick={() => (mode = "values")}>
              Distinct values ({result.buckets.length})
            </button>
            <button class="btn" class:on={mode === "carriers"} onclick={() => (mode = "carriers")}>
              Per bundle ({result.scanned})
            </button>
            <span class="grow"></span>
            <span class="dimtext">
              {result.hits.filter((h) => h.present).length} of {result.scanned} set this key
              {#if result.truncated}&middot; capped from {result.candidates}{/if}
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
                      {#each b.carriers.slice(0, 14) as name (name)}
                        <button class="chip" onclick={() => openCarrier(name)}>{name}</button>
                      {/each}
                      {#if b.carriers.length > 14}<span class="dimtext">+{b.count - 14} more</span>{/if}
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
                    <td class="k"><button class="chip" onclick={() => openCarrier(h.name)}>{h.name}</button></td>
                    <td class="mono">{h.os}</td>
                    <td class="mono">{h.build}</td>
                    <td class="mono wrap">
                      {#if h.error}<span class="dimtext">{h.error}</span>
                      {:else if !h.present}<span class="dimtext">absent</span>
                      {:else}{shortValue(h.value, 300)}{/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}

          <div class="rowflex" style="margin-top:8px">
            <button class="btn" onclick={() => copyText(JSON.stringify(result, null, 2))}>Copy result JSON</button>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}
