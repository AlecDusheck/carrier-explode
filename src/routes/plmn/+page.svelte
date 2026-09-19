<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { getPlmn } from "$lib/api/tables.remote";
  import { bundleHref, withParams } from "$lib/format";
  import Pane from "$lib/components/Pane.svelte";

  const LIMIT = 400;

  // Follows the URL, and runs ahead of it while typing.
  let q = $derived(page.url.searchParams.get("q") ?? "");
  const f = $derived(q.trim().toLowerCase());

  const mvnoKey = (m: { iccid?: string; gid1?: string; gid2?: string }) =>
    m.iccid ? "ICCID " + m.iccid : m.gid2 ? "GID2 " + m.gid2 : m.gid1 ? "GID1 " + m.gid1 : "";

  const match = (pairs: Array<[string, string]>) =>
    f ? pairs.filter(([k, v]) => k.toLowerCase().includes(f) || v.toLowerCase().includes(f)) : pairs;
</script>

{#snippet pairTable(title: string, head: string, pairs: Array<[string, string]>)}
  <fieldset class="hgroup">
    <legend>{title} ({pairs.length})</legend>
    <table class="grid">
      <thead><tr><th>{head}</th><th>Bundle</th></tr></thead>
      <tbody>
        {#each pairs as [k, v] (k)}
          <tr><td class="mono k">{k}</td><td><a class="chip" href={bundleHref("carriers", v)}>{v}</a></td></tr>
        {/each}
      </tbody>
    </table>
  </fieldset>
{/snippet}

<div class="view">
  <div class="toolbar">
    <input
      class="grow"
      type="search"
      name="q"
      placeholder="MCC+MNC, bundle name or ICCID prefix"
      aria-label="search"
      bind:value={q}
      oninput={() => goto(withParams(page.url, { q }), { replaceState: true, keepFocus: true, noScroll: true })}
    />
  </div>
  <div class="scroll pad">
    <Pane>
      {@const table = await getPlmn()}
      {@const hits = f
        ? table.entries.filter((e) =>
            e.plmn.startsWith(f) ||
            (e.bundle ?? "").toLowerCase().includes(f) ||
            e.mvnos.some((m) => m.bundle.toLowerCase().includes(f) || (m.iccid ?? "").startsWith(f)))
        : table.entries}
      <p class="dimtext" style="margin:0 0 6px">
        {hits.length} of {table.entries.length} networks{hits.length > LIMIT ? `, first ${LIMIT} shown` : ""}
      </p>
      <table class="grid">
        <thead><tr><th class="num">MCC</th><th class="num">MNC</th><th>Bundle</th><th>MVNOs</th></tr></thead>
        <tbody>
          {#each hits.slice(0, LIMIT) as e (e.plmn)}
            <tr>
              <td class="num mono">{e.mcc}</td>
              <td class="num mono">{e.mnc}</td>
              <td>{#if e.bundle}<a class="chip" href={bundleHref("carriers", e.bundle)}>{e.bundle}</a>{/if}</td>
              <td>
                {#each e.mvnos as m, i (i)}
                  <a class="chip" href={bundleHref("carriers", m.bundle)}>{m.bundle} <span class="dimtext">{mvnoKey(m)}</span></a>
                {/each}
              </td>
            </tr>
          {:else}
            <tr><td colspan="4" class="dimtext">No match</td></tr>
          {/each}
        </tbody>
      </table>

      {@render pairTable("ICCID prefixes", "ICCID prefix", match(table.iccids))}
      {@render pairTable("Carrier IDs", "Carrier ID", match(table.carrierIds))}
    </Pane>
  </div>
</div>
