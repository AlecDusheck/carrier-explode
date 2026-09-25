<script lang="ts">
  import { page } from "$app/state";
  import { getCbs } from "$lib/api/tables.remote";
  import { describeMessageId } from "$lib/decode";
  import type { CbsRow } from "$lib/server/cbs";
  import { link } from "$lib/format";
  import Pane from "$lib/components/Pane.svelte";

  const view = $derived(page.url.searchParams.get("view") === "matrix" ? "matrix" : "operator");

  const detail = (r: CbsRow) => link("/cell-broadcast/" + encodeURIComponent(r.country));
  const shortType = (t?: string) => (t ? t.replace(/Alert$/, "").replace(/([a-z])([A-Z])/g, "$1 $2") : "");

  function alertFor(row: CbsRow, id: number) {
    const m = row.mappings.find((x) => id >= x.from && id <= x.to);
    if (!m?.alertType) return null;
    return { type: m.alertType, locked: row.alertTypes.find((a) => a.name === m.alertType)?.userConfigurable === false };
  }
</script>

<div class="view">
  <div class="toolbar">
    <a class="btn" href={link("/cell-broadcast")} aria-current={view === "operator" ? "page" : undefined}>Operator-defined 4382</a>
    <a class="btn" href={link("/cell-broadcast") + "?view=matrix"} aria-current={view === "matrix" ? "page" : undefined}>ID matrix</a>
  </div>

  <div class="scroll pad">
    <Pane>
      {@const data = await getCbs()}
      {@const configured = data.rows.filter((r) => r.mappings.length > 0)}
      {@const bare = data.rows.filter((r) => r.mappings.length === 0 && !r.error)}

      {#if view === "operator"}
        {@const mapped = configured.filter((r) => r.maps4382)}
        <p class="lead" style="margin-top:0">
          4382 is the operator-defined CMAS message ID; {mapped.length} of {configured.length} bundles map it.
        </p>
        <table class="grid">
          <thead>
            <tr>
              <th class="sticky-col">Country</th><th>4382</th><th>Alert type</th>
              <th>User can disable</th><th>Settings section</th><th class="num">Build</th><th>Source</th>
            </tr>
          </thead>
          <tbody>
            {#each configured as r (r.country)}
              <tr>
                <td class="sticky-col k"><a href={detail(r)}>{r.countryName ?? r.country}</a></td>
                <td>
                  {#if r.maps4382}<span class="chip warn">mapped</span>{:else}<span class="chip good">not mapped</span>{/if}
                </td>
                <td>{shortType(r.alertType4382)}</td>
                <td>
                  {#if !r.maps4382}<span class="dimtext">n/a</span>
                  {:else if r.configurable4382 === false}<span class="chip bad">no off switch</span>
                  {:else if r.configurable4382 === true}<span class="chip good">yes</span>
                  {:else}<span class="dimtext">unstated</span>{/if}
                </td>
                <td>{r.switchGroupTitle ?? ""}</td>
                <td class="num mono">{r.version}</td>
                <td class="dimtext">{r.source === "image" && data.image ? "iOS " + data.image.version + " image" : "OTA"}</td>
              </tr>
            {/each}
          </tbody>
        </table>

        {#if bare.length}
          <fieldset class="hgroup">
            <legend>No CellBroadcast block ({bare.length})</legend>
            {#each bare as r (r.country)}<a class="chip" href={detail(r)}>{r.countryName ?? r.country}</a>{/each}
          </fieldset>
        {/if}

        <fieldset class="hgroup">
          <legend>Alert types with no off switch</legend>
          <table class="grid">
            <tbody>
              {#each configured as r (r.country)}
                {@const locked = r.alertTypes.filter((a) => a.userConfigurable === false)}
                {#if locked.length}
                  <tr>
                    <td class="k"><a href={detail(r)}>{r.countryName ?? r.country}</a></td>
                    <td>{#each locked as a (a.name)}<span class="chip bad">{a.name}</span>{/each}</td>
                  </tr>
                {/if}
              {/each}
            </tbody>
          </table>
        </fieldset>
      {:else}
        <p class="dimtext" style="margin-top:0">Blank: unmapped, ignored by the phone. Locked: no off switch.</p>
        <table class="grid">
          <thead>
            <tr>
              <th class="sticky-col num">ID</th>
              <th style="min-width:190px">3GPP TS 23.041</th>
              {#each configured as r (r.country)}
                <th title={r.countryName ?? r.country} style="writing-mode:vertical-rl; padding:6px 2px">
                  <a href={detail(r)}>{r.country}</a>
                </th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each data.messageIds as id (id)}
              <tr>
                <td class="sticky-col k num">{id}</td>
                <td class="dimtext">{describeMessageId(id) ?? ""}</td>
                {#each configured as r (r.country)}
                  {@const a = alertFor(r, id)}
                  <td style="white-space:nowrap; font-size:10px">
                    {#if a}{shortType(a.type)}{#if a.locked}<span class="chip bad">locked</span>{/if}{/if}
                  </td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </Pane>
  </div>
</div>
