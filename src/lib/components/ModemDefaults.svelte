<script lang="ts">
  import { page } from "$app/state";
  import { getBasebandDefaults, getBasebandOverride } from "$lib/api/tables.remote";
  import type { Kind } from "$lib/server/data";
  import { link, shortValue, withParams } from "$lib/format";
  import Pane from "./Pane.svelte";
  import Variants from "./Variants.svelte";

  let { kind, name, slug }: { kind: Kind; name: string; slug?: string } = $props();

  const efs = $derived(page.url.searchParams.get("efs"));
  const base = $derived(page.url.searchParams.get("base"));
  const bands = (xs: number[], p: string) => xs.map((b) => p + b).join(" ");
  const compareHref = (pri: string, path: string, i: number) =>
    withParams(page.url, { file: pri, efs: path, base: String(i) }) + "#override";
</script>

<fieldset class="hgroup" id="modem">
  <legend>Modem defaults</legend>
  <Pane>
    {@const d = await getBasebandDefaults({ kind, name, slug })}
    {#if d.missing}
      <p class="dimtext note">
        {d.build ? `No .bbfw modem package of ${d.build} is stored yet.` : "No image to read a baseband package from."}
      </p>
    {:else}
      {@const pkg = link("/baseband/" + d.build) + "?family=" + encodeURIComponent(d.family)}
      <p class="dimtext note">
        What the modem holds before this bundle's .der.pri arrives, from the <a href={pkg}>iOS {d.version} {d.family} baseband package</a>.
        The .der.pri then overwrites the same EFS paths.
      </p>

      <h4>Band combos</h4>
      {#each d.tags as t (t.tag)}
        <div class="rowflex">
          <a class="chip" href="{pkg}#{t.tag}"><b>{t.tag}</b></a>
          <span class="dimtext">{t.primary ? "default bundle on" : "MVNO on"} {t.plmns.join(" ")}</span>
        </div>
        <div class="hscroll">
          <table class="grid">
            <thead><tr><th>Platforms</th><th class="num">Combos</th><th class="num">EN-DC</th><th class="num">NR-DC</th><th>NR bands</th><th>LTE anchors</th></tr></thead>
            <tbody>
              {#each t.sets as s (s.sha1)}
                <tr>
                  <td class="plat"><Variants variants={s.variants} /></td>
                  <td class="num">{s.combos}</td>
                  <td class="num">{s.endc}</td>
                  <td class="num">{s.nrdc}</td>
                  <td class="mono bands">{bands(s.nrBands, "n")}</td>
                  <td class="mono bands">{bands(s.lteAnchors, "B")}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <p class="dimtext note">No carrier in band_combos_per_plmn.xml lists a PLMN that routes to {name}.</p>
      {/each}

      <h4>Package files this bundle replaces</h4>
      {#if d.overrides.length}
        <!-- The .der.pri column only earns its place when more than one file is in play. -->
        {@const several = new Set(d.overrides.map((o) => o.pri)).size > 1}
        <div class="hscroll">
          <table class="grid">
            <thead><tr><th>EFS path</th>{#if several}<th>Set by</th>{/if}<th>Package copy</th><th></th></tr></thead>
            <tbody>
              {#each d.overrides as o, oi (oi)}
                {#each o.baseline as b (b.i)}
                  <tr class:sel={efs === o.efs && base === String(b.i) && page.url.searchParams.get("file") === o.pri}>
                    <td class="mono wrap">{o.efs}</td>
                    {#if several}<td class="mono wrap">{o.pri}</td>{/if}
                    <td><span class="mono">{b.member}</span> <Variants variants={b.variants} configs={b.configs} /></td>
                    <td>
                      {#if b.same}<span class="chip good">identical</span>
                      {:else}<a class="btn" href={compareHref(o.pri, o.efs, b.i)} data-sveltekit-noscroll data-sveltekit-replacestate>Compare</a>{/if}
                    </td>
                  </tr>
                {/each}
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <p class="dimtext note">None of this bundle's .der.pri values land on a path the package also writes.</p>
      {/if}
      {#if d.otherXml}<p class="dimtext note">{d.otherXml} other XML values go to paths the package leaves unset.</p>{/if}

      {#if efs && base !== null}
        {@const pri = page.url.searchParams.get("file") ?? ""}
        <div id="override" class="override">
          <Pane>
            {@const o = await getBasebandOverride({ kind, name, slug, id: d.id, pri, efs, i: Number(base) })}
            <div class="rowflex">
              <b class="mono wrap">{o.efs}</b>
              <span class="dimtext">{o.counts.changed + o.counts.added + o.counts.removed} lines differ</span>
              <span class="grow"></span>
              <a class="btn" href={withParams(page.url, { efs: null, base: null })} data-sveltekit-noscroll data-sveltekit-replacestate>Close</a>
            </div>
            <div class="sides">
              <div>
                <div class="dimtext">Package default ({o.member}, {o.where})</div>
                <pre class="code">{o.baseline}</pre>
              </div>
              <div>
                <div class="dimtext">{o.pri}</div>
                <pre class="code">{o.override}</pre>
              </div>
            </div>
            {#if o.rows.length}
              <details>
                <summary>Changed lines ({o.rows.length})</summary>
                <div class="hscroll">
                  <table class="grid">
                    <thead><tr><th>Line</th><th>Package</th><th>Bundle</th></tr></thead>
                    <tbody>
                      {#each o.rows as r, i (i)}
                        <tr>
                          <td class="mono">{r.path}</td>
                          <td class="mono wrap">{r.a === undefined ? "" : shortValue(r.a, 400)}</td>
                          <td class="mono wrap">{r.b === undefined ? "" : shortValue(r.b, 400)}</td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              </details>
            {/if}
          </Pane>
        </div>
      {/if}
    {/if}
  </Pane>
</fieldset>

<style>
  .note { margin: 0 0 6px; }
  h4 { margin: 8px 0 4px; }
  .rowflex { margin: 4px 0; }
  tr.sel td { background: #e3ebf5; }
  td.bands { min-width: 14em; }
  td.plat { white-space: nowrap; }
  .override { margin-top: 8px; scroll-margin-top: 8px; }
  .sides { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 6px 0; }
  .sides > div { min-width: 0; }
  @media (max-width: 760px) {
    .sides { grid-template-columns: 1fr; }
  }
</style>
