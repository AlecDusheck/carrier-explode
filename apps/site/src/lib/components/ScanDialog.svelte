<script lang="ts">
  import type { Attachment } from "svelte/attachments";
  import { scanKey } from "#lib/api/scan.remote.ts";
  import { shortValue } from "#lib/format.ts";
  import { decoderFamily } from "@carrier-explode/schema/types";
  import { SOURCE_NOUNS } from "#lib/platforms.ts";
  import { scan, copyText, scopeOptions, type ScanScope } from "#lib/ui-state.svelte.ts";
  import Pane from "./Pane.svelte";
  import SourceChip from "./SourceChip.svelte";

  let mode = $state<"values" | "sources">("values");
  let anyIndex = $state(false);

  const q = $derived(scan.query);
  const indexed = $derived(/\[\d+\]/.test(q.path));
  const path = $derived(anyIndex ? q.path.replace(/\[\d+\]/g, "[*]") : q.path);
  const args = $derived({ platform: q.platform, path, file: q.file, scope: q.scope });
  const scopes = $derived(scopeOptions(q.platform, q.scope));

  const words = $derived(SOURCE_NOUNS[decoderFamily(q.platform)]);
  const title = $derived(`Setting across ${words.many}`);
  const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
  const close = (): void => {
    scan.open = false;
  };
  // A modal dialog keeps focus inside, closes on Escape and hands focus back when it goes.
  const modal: Attachment<HTMLDialogElement> = (dialog) => {
    dialog.showModal();
    return () => dialog.close();
  };
  const setScope = (scope: ScanScope): void => {
    scan.query = { ...q, scope };
  };
</script>

<!-- A click on the backdrop lands on the dialog itself. -->
<dialog class="dialog" aria-label={title} {@attach modal} onclose={close} onclick={(e) => e.target === e.currentTarget && close()}>
    <div class="titlebar">
      <span>{title}</span>
      <span class="spacer"></span>
      <button class="btn" onclick={close}>Close</button>
    </div>

    <div class="toolbar">
      <span class="mono breakall">{path}</span>
      <span class="dimtext">in {q.file || "the file's root"}</span>
      <span class="grow"></span>
      {#if indexed}
        <label class="lbl">
          <input type="checkbox" name="any-index" bind:checked={anyIndex} />
          Match all indexes
        </label>
      {/if}
      <label class="lbl">
        Scope
        <select name="scope" value={q.scope} onchange={(e) => setScope(scopes.find(([s]) => s === e.currentTarget.value)?.[0] ?? q.scope)}>
          {#each scopes as [value, label] (value)}
            <option {value}>{label}</option>
          {/each}
        </select>
      </label>
    </div>

    <div class="scroll pad">
      <!-- A scan can take a while; a fresh boundary per request shows the pending line instead of stale rows. -->
      {#key args}
        <Pane awaiting={{ kind: "scan", name: words.many }}>
          {@const result = await scanKey(args)}
          <div class="filters">
            <button class="btn" class:on={mode === "values"} aria-pressed={mode === "values"} onclick={() => (mode = "values")}>
              Distinct values ({result.buckets.length})
            </button>
            <button class="btn" class:on={mode === "sources"} aria-pressed={mode === "sources"} onclick={() => (mode = "sources")}>
              Per {words.one} ({result.hits.length})
            </button>
            <span class="grow"></span>
            <span class="dimtext">scanned {result.scanned}, set {result.set}{#if result.defaulted}, build default {result.defaulted}{/if}</span>
          </div>

          {#if mode === "values"}
            <table class="grid">
              <thead><tr><th class="num">Count</th><th>Value</th><th>{capital(words.many)}</th></tr></thead>
              <tbody>
                {#each result.buckets as b, i (i)}
                  <tr>
                    <td class="num">{b.count}</td>
                    <td class="mono">
                      {#if b.held === "absent"}<span class="dimtext">absent</span>{:else}{shortValue(b.value, 400)}{/if}
                      {#if b.held === "default"}<span class="dimtext">build default</span>{/if}
                    </td>
                    <td>
                      {#each b.sources.slice(0, 14) as source (source.key)}<SourceChip {source} onclick={close} />{/each}
                      {#if b.count > 14}<span class="dimtext">+{b.count - 14} more</span>{/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {:else}
            <table class="grid">
              <thead><tr><th>{capital(words.one)}</th><th>Version</th><th>Value</th></tr></thead>
              <tbody>
                {#each result.hits as h (h.source.key)}
                  <tr>
                    <td class="k"><SourceChip source={h.source} onclick={close} /></td>
                    <td class="mono">{h.version ?? ""}</td>
                    <td class="mono">
                      {#if h.held === "absent"}<span class="dimtext">absent</span>
                      {:else if h.held === "default"}
                        {#each h.matches as m (m.path)}
                          <div>{#if m.path !== result.path}<span class="dimtext">{m.path}</span> {/if}{shortValue(m.value, 300)} <span class="dimtext">build default</span></div>
                        {/each}
                      {:else if h.matches.length === 1 && h.matches[0]?.path === result.path}
                        {shortValue(h.matches[0]?.value, 300)}
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
</dialog>
