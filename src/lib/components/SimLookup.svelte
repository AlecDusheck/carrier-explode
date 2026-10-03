<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { getPlmn } from "#lib/api/tables.remote.ts";
  import { bundleHref, withParams } from "#lib/format.ts";

  const LIMIT = 200;

  // Follows the URL, and runs ahead of it while typing.
  let q = $derived(page.url.searchParams.get("q") ?? "");
  const f = $derived(q.trim().toLowerCase().replace(/[\s-]/g, ""));

  const mvnoKey = (m: { iccid?: string; gid1?: string; gid2?: string }) =>
    [m.gid1 && "GID1 " + m.gid1, m.gid2 && "GID2 " + m.gid2, m.iccid && "ICCID " + m.iccid + "…"].filter(Boolean).join(", ");
</script>

<fieldset class="hgroup">
  <legend>Find the bundle for a SIM</legend>
  <p class="dimtext note">
    Search by MCC-MNC (310410), ICCID prefix (8901410) or bundle name. A plain MCC-MNC match applies to SIMs no MVNO rule claims;
    MVNO rules match on GID1, GID2 or ICCID first.
  </p>
  <div class="filters">
    <input
      class="grow"
      type="search"
      name="q"
      placeholder="MCC-MNC, ICCID prefix or bundle name"
      aria-label="find a bundle by MCC-MNC, ICCID prefix or name"
      bind:value={q}
      oninput={() => goto(withParams(page.url, { q: q || null }), { replace: true, reset: false })}
    />
  </div>
  {#if f}
    {@const t = await getPlmn()}
    {@const nets = t.entries.filter((e) =>
      e.plmn.startsWith(f) || (e.bundle ?? "").toLowerCase().includes(f) ||
      e.mvnos.some((m) => m.bundle.toLowerCase().includes(f) || (m.iccid ?? "").startsWith(f)))}
    {@const iccids = t.iccids.filter(([k, v]) => k.startsWith(f) || f.startsWith(k) || v.toLowerCase().includes(f))}
    {@const ids = t.carrierIds.filter(([k, v]) => k.toLowerCase().includes(f) || v.toLowerCase().includes(f))}
    <table class="grid">
      <thead><tr><th>By</th><th>Value</th><th>Bundle</th><th>MVNO rules</th></tr></thead>
      <tbody>
        {#each nets.slice(0, LIMIT) as e (e.plmn)}
          <tr>
            <td>MCC-MNC</td>
            <td class="mono">{e.mcc}-{e.mnc}</td>
            <td>{#if e.bundle}<a href={bundleHref("carriers", e.bundle)}>{e.bundle}</a>{:else}<span class="dimtext">MVNO rules only</span>{/if}</td>
            <td>
              {#each e.mvnos as m, i (i)}
                <div><a href={bundleHref("carriers", m.bundle)}>{m.bundle}</a> <span class="dimtext">{mvnoKey(m)}</span></div>
              {/each}
            </td>
          </tr>
        {/each}
        {#each iccids as [k, v] (k)}
          <tr><td>ICCID</td><td class="mono">{k}…</td><td><a href={bundleHref("carriers", v)}>{v}</a></td><td></td></tr>
        {/each}
        {#each ids as [k, v] (k)}
          <tr><td>Carrier ID</td><td class="mono">{k}</td><td><a href={bundleHref("carriers", v)}>{v}</a></td><td></td></tr>
        {/each}
        {#if !nets.length && !iccids.length && !ids.length}
          <tr><td colspan="4" class="dimtext">No bundle matches.</td></tr>
        {/if}
      </tbody>
    </table>
    {#if nets.length > LIMIT}<p class="dimtext note">First {LIMIT} of {nets.length} networks; type more to narrow.</p>{/if}
  {/if}
</fieldset>
