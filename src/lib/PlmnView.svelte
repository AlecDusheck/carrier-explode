<script lang="ts">
  import { api } from "./api.ts";
  import { router, resource } from "./state.svelte.ts";

  let q = $state("");

  const table = resource(() => api.mccmnc());
  const entries = $derived(table.value?.entries ?? null);
  const carrierIds = $derived(table.value?.carrierIds ?? []);
  const iccids = $derived(table.value?.iccids ?? []);
  const error = $derived(table.error);

  const filtered = $derived.by(() => {
    if (!entries) return [];
    const f = q.trim().toLowerCase();
    if (!f) return entries.slice(0, 400);
    return entries
      .filter((e) =>
        e.plmn.startsWith(f) ||
        (e.bundle ?? "").toLowerCase().includes(f) ||
        e.mvnos.some((m) => m.bundle.toLowerCase().includes(f) || (m.iccid ?? "").startsWith(f)))
      .slice(0, 400);
  });

  const match = (pairs: Array<[string, string]>) => {
    const f = q.trim().toLowerCase();
    if (!f) return pairs;
    return pairs.filter(([k, v]) => k.toLowerCase().includes(f) || v.toLowerCase().includes(f));
  };
  const filteredIds = $derived(match(carrierIds));
  const filteredIccids = $derived(match(iccids));

  const mvnoKey = (m: { iccid?: string; gid1?: string; gid2?: string }) =>
    m.iccid ? "ICCID " + m.iccid : m.gid2 ? "GID2 " + m.gid2 : m.gid1 ? "GID1 " + m.gid1 : "";
</script>

{#if error}
  <div class="scroll pad"><div class="banner err">{error}</div></div>
{:else}
  <div class="toolbar">
    <input class="grow" type="search" placeholder="MCC+MNC such as 310410, a bundle name, or an ICCID prefix" bind:value={q} />
    <span class="dimtext">{entries ? entries.length + " networks" : "loading"}</span>
  </div>
  <div class="scroll pad">
    <p class="lead dimtext" style="margin-top:0">
      How the handset picks a bundle: it reads MCC+MNC from the SIM and looks it up here. An MVNO riding
      on a host network is disambiguated further by an ICCID prefix or by the SIM's GID1/GID2 bytes. At
      most 400 rows are shown; narrow the search for the rest.
    </p>
    <table class="grid">
      <thead>
        <tr><th class="num">MCC</th><th class="num">MNC</th><th>Bundle</th><th>MVNOs</th></tr>
      </thead>
      <tbody>
        {#each filtered as e (e.plmn)}
          <tr>
            <td class="num mono">{e.mcc}</td>
            <td class="num mono">{e.mnc}</td>
            <td>
              {#if e.bundle}
                <button class="chip" onclick={() => router.go("carriers", e.bundle)}>{e.bundle}</button>
              {/if}
            </td>
            <td>
              {#each e.mvnos as m, i (i)}
                <span class="chip" title={mvnoKey(m)}>
                  <button class="chip" style="border:0; background:none; padding:0" onclick={() => router.go("carriers", m.bundle)}>{m.bundle}</button>
                  <span class="dimtext">{mvnoKey(m)}</span>
                </span>
              {/each}
            </td>
          </tr>
        {:else}
          <tr><td colspan="5" class="dimtext">nothing matches</td></tr>
        {/each}
      </tbody>
    </table>

    <fieldset class="hgroup">
      <legend>ICCID prefixes ({filteredIccids.length})</legend>
      <p class="dimtext" style="margin-top:0">
        MobileDeviceCarriers is keyed by ICCID prefix rather than by PLMN: a longest-prefix match on the
        SIM's own serial number, used where MCC+MNC alone does not identify the operator.
      </p>
      <table class="grid">
        <thead><tr><th>ICCID prefix</th><th>Bundle</th></tr></thead>
        <tbody>
          {#each filteredIccids as [k, v] (k)}
            <tr>
              <td class="mono k">{k}</td>
              <td><button class="chip" onclick={() => router.go("carriers", v)}>{v}</button></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </fieldset>

    <fieldset class="hgroup">
      <legend>Carrier IDs ({filteredIds.length})</legend>
      <p class="dimtext" style="margin-top:0">US CDMA-style carrier IDs, matched instead of an MCC+MNC pair.</p>
      <table class="grid">
        <thead><tr><th>Carrier ID</th><th>Bundle</th></tr></thead>
        <tbody>
          {#each filteredIds as [k, v] (k)}
            <tr>
              <td class="mono k">{k}</td>
              <td><button class="chip" onclick={() => router.go("carriers", v)}>{v}</button></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </fieldset>
  </div>
{/if}
