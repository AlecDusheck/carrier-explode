<script lang="ts">
  import { dialectLabel, type PriDecoded } from "@carrier-explode/decode-ios";
  import PriValueCell from "./PriValueCell.svelte";
  import Confidence from "../Confidence.svelte";
  import IntelView from "./IntelView.svelte";
  import DecodeNotes from "../modem/DecodeNotes.svelte";
  import Facts from "../modem/Facts.svelte";

  /** An Intel-dialect override file: no Qualcomm items, so no ModemConfig; its keys read as the Intel tree. */
  let { pri, devices = true }: {
    pri: PriDecoded;
    /** Off where a phone picker already names the modem. */
    devices?: boolean;
  } = $props();

  const has = (f: string, ...xs: Array<string | undefined>) => xs.some((x) => x?.toLowerCase().includes(f));

  const pick = (q: string) => {
    const f = q.trim().toLowerCase();
    if (!f) return pri.efs;
    return pri.efs.filter((e) => has(f, e.path, e.value.text, e.name, e.meaning, e.label));
  };

  const modem = $derived(devices ? dialectLabel(pri.dialect) : undefined);
  // Empty header fields ("Carrier ID" on most files) say nothing.
  const facts = $derived([
    ...(modem ? [{ label: "Dialect", value: modem }] : []),
    ...Object.entries(pri.header).filter(([, v]) => v !== "").map(([label, value]) => ({ label, value })),
  ]);
</script>

<Facts {facts} />

{#snippet keyList(q: string)}
  <table class="grid">
    <thead><tr><th class="setting">Setting</th><th>Value</th></tr></thead>
    <tbody>
      {#each pick(q) as e, i (i)}
        <tr>
          <td>
            {#if e.name}<div><b>{e.name}</b><Confidence c={e.confidence} /></div>{/if}
            {#if e.meaning}<div class="dimtext">{e.meaning}</div>{/if}
            <div class="mono path">{e.path}</div>
          </td>
          <td><PriValueCell v={e.value} label={e.label} /></td>
        </tr>
      {:else}
        <tr><td colspan="2" class="dimtext">No override pairs in this file.</td></tr>
      {/each}
    </tbody>
  </table>
{/snippet}

<fieldset class="hgroup">
  <legend>Baseband overrides ({pri.efs.length})<DecodeNotes errors={pri.errors} /></legend>
  {#if pri.intel}
    <IntelView tree={pri.intel} flat={keyList} />
  {:else}
    {@render keyList("")}
  {/if}
</fieldset>

<style>
  /* A share of the width only where there is width to share; on a phone it would widen the table past the screen. */
  @media (min-width: 761px) { .setting { width: 58%; } }
  .path { font-size: 10.5px; word-break: break-all; }
  /* Setting names are long snake_case words; let them break so one can't set the column's width. */
</style>
