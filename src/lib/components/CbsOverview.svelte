<script lang="ts">
  import { page } from "$app/state";
  import { getCbs } from "#lib/api/tables.remote.ts";
  import { describeMessageId } from "#lib/decode/index.ts";
  import type { CbsRow } from "#lib/types.ts";
  import { bundleHref, cbsEntryLabel, link } from "#lib/format.ts";
  import Pane from "#lib/components/Pane.svelte";

  const VIEWS = [["", "By country"], ["4382", "Operator-defined 4382"], ["matrix", "Message ID matrix"]] as const;
  type View = (typeof VIEWS)[number][0];
  const view = $derived.by((): View => {
    const v = page.url.searchParams.get("view");
    return v === "matrix" || v === "4382" ? v : "";
  });

  const detail = (r: CbsRow) => bundleHref("countries", r.country) + "?tab=alerts";
  const shortType = (t?: string) => (t ? t.replace(/Alert$/, "").replace(/([a-z])([A-Z])/g, "$1 $2") : "");
  // "country" is the default view, named so the URL can ask for the overview on a phone.
  const viewHref = (v: View) => link("/countries") + "?view=" + (v || "country");

  function alertFor(row: CbsRow, id: number) {
    const m = row.mappings.find((x) => id >= x.from && id <= x.to);
    if (!m?.alertType) return null;
    return { type: m.alertType, locked: row.alertTypes.find((a) => a.name === m.alertType)?.userConfigurable === false };
  }

  /** The types a user sees in Settings; ones with no switch (WHAM geofence triggers) stay on the country page. */
  const switches = (r: CbsRow) => {
    const named = r.alertTypes.filter((a) => a.switchName);
    return named.length ? named : r.alertTypes;
  };
</script>

<fieldset class="hgroup">
  <legend>Emergency alerts by country</legend>
  <div class="filters">
    {#each VIEWS as [v, label] (v)}
      <a class="btn" href={viewHref(v)} aria-current={view === v ? "page" : undefined}>{label}</a>
    {/each}
  </div>
    <Pane>
      {@const data = await getCbs()}
      {@const configured = data.rows.filter((r) => r.mappings.length > 0)}
      {@const bare = data.rows.filter((r) => r.mappings.length === 0 && !r.error)}
      <!-- Where the bundles came from is said once for the common source; rows from the other one say their own. -->
      {@const usual = configured[0]?.source}

      {#if view === ""}
        <p class="lead top">
          The alert switches each country's bundle gives an iPhone.
          {#if usual}<span class="dimtext">From {usual === "image" && data.image ? `the iOS ${data.image.version} image` : "OTA bundles"} unless noted.</span>{/if}
        </p>
        <table class="grid">
          <thead><tr><th class="sticky-col">Country</th><th>Alerts</th><th>Settings section</th></tr></thead>
          <tbody>
            {#each configured as r (r.country)}
              <tr>
                <td class="sticky-col k">
                  <a href={detail(r)}>{r.countryName ?? r.country}</a>
                  {#if r.source !== usual}<div class="dimtext">{cbsEntryLabel(r, data.image)}</div>{/if}
                </td>
                <td>
                  {#each switches(r) as a (a.name)}
                    <span class="alert" title={a.name}>
                      {a.switchName || shortType(a.name)}{#if a.userConfigurable === false}<span class="chip bad sp">no off switch</span>{/if}{#if a.enabledByDefault === false}<span class="dimtext sp">off by default</span>{/if}
                    </span>
                  {/each}
                </td>
                <td>{r.switchGroupTitle ?? ""}</td>
              </tr>
            {/each}
          </tbody>
        </table>

        {#if bare.length}
          <p class="dimtext note gap-above">No alert configuration: {bare.length} country bundles.</p>
        {/if}
      {:else if view === "4382"}
        {@const mapped = configured.filter((r) => r.maps4382)}
        <p class="lead top">
          4382 is the operator-defined CMAS message ID: {mapped.length} of {configured.length} countries with alerts map it.
        </p>
        <table class="grid">
          <thead><tr><th class="sticky-col">Country</th><th>Shown as</th><th>User can disable</th></tr></thead>
          <tbody>
            {#each mapped as r (r.country)}
              <tr>
                <td class="sticky-col k"><a href={detail(r)}>{r.countryName ?? r.country}</a></td>
                <td>{shortType(r.alertType4382)}</td>
                <td>
                  {#if r.configurable4382 === false}<span class="chip bad">no off switch</span>
                  {:else if r.configurable4382 === true}yes
                  {:else}<span class="dimtext">unstated</span>{/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <p class="dimtext top">Blank: unmapped, ignored by the phone. Locked: no off switch.</p>
        <table class="grid">
          <thead>
            <tr>
              <th class="sticky-col num">ID</th>
              <th class="spec">3GPP TS 23.041</th>
              {#each configured as r (r.country)}
                <th title={r.countryName ?? r.country} class="vertical">
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
                  <td class="cell">
                    {#if a}{shortType(a.type)}{#if a.locked}<span class="chip bad">locked</span>{/if}{/if}
                  </td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </Pane>
</fieldset>

<style>
  .alert { display: inline-block; margin: 0 10px 2px 0; }
  .top { margin-top: 0; }
  th.spec { min-width: 190px; }
  th.vertical { writing-mode: vertical-rl; padding: 6px 2px; }
  td.cell { white-space: nowrap; font-size: 10px; }
</style>
