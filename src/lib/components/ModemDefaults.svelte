<script lang="ts">
  import { page } from "$app/state";
  import { getBasebandDefaults, getBasebandOverride } from "$lib/api/tables.remote";
  import { modemLabel } from "$lib/decode";
  import type { Kind } from "$lib/types";
  import { link, withParams } from "$lib/format";
  import Pane from "./Pane.svelte";
  import Variants from "./Variants.svelte";
  import ComboStatsTable from "./ComboStatsTable.svelte";
  import DiffRows from "./DiffRows.svelte";

  let { kind, name, slug, device, phone }: { kind: Kind; name: string; slug?: string; device: string; phone: string } = $props();

  /** The package file opened next to the .der.pri value that replaces it: ?pri=&efs=&base=. */
  const selection = $derived.by(() => {
    const sp = page.url.searchParams;
    const pri = sp.get("pri"), efs = sp.get("efs"), base = sp.get("base");
    return pri && efs && base ? { pri, efs, i: Number(base) } : null;
  });
  const compareHref = (pri: string, efs: string, i: number) => withParams(page.url, { pri, efs, base: String(i) }) + "#override";
  const closeHref = $derived(withParams(page.url, { pri: null, efs: null, base: null }));
</script>

<fieldset class="hgroup" id="modem">
  <legend>Modem defaults</legend>
  <Pane>
    {@const d = await getBasebandDefaults({ kind, name, slug, device })}
    {#if d.missing}
      <p class="dimtext note">
        {d.build ? `No ${phone} modem package stored for ${d.build}.` : "No image to read a baseband package from."}
      </p>
    {:else}
      {@const pkg = link(`/baseband/${d.build}/${d.family}`)}
      <p class="dimtext note">
        From the <a href={pkg}>iOS {d.version} {modemLabel(d.family)} package</a>, before this bundle's .der.pri.
      </p>

      <h4>Band combos</h4>
      {#each d.tags as t (t.tag)}
        <div class="rowflex">
          <a class="chip" href="{pkg}#{t.tag}"><b>{t.tag}</b></a>
          <span class="dimtext">{t.primary ? "default bundle on" : "MVNO on"} {t.plmns.join(" ")}</span>
        </div>
        <ComboStatsTable rows={t.sets} />
      {:else}
        <p class="dimtext note">None for this bundle's PLMNs.</p>
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
                  <tr class:sel={selection?.efs === o.efs && selection.i === b.i && selection.pri === o.pri}>
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
        <p class="dimtext note">None.</p>
      {/if}
      {#if d.otherXml}<p class="dimtext note">{d.otherXml} more XML values set paths the package leaves unset.</p>{/if}

      {#if selection}
        <div id="override" class="override">
          <Pane>
            {@const o = await getBasebandOverride({ kind, name, slug: d.slug, id: d.id, ...selection })}
            <div class="rowflex">
              <b class="mono wrap">{o.efs}</b>
              <span class="dimtext">{o.counts.changed + o.counts.added + o.counts.removed} lines differ</span>
              <span class="grow"></span>
              <a class="btn" href={closeHref} data-sveltekit-noscroll data-sveltekit-replacestate>Close</a>
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
              <details class="more">
                <summary>Changed lines ({o.rows.length})</summary>
                <DiffRows rows={o.rows} head="Line" left="Package" right="Bundle" lines />
              </details>
            {/if}
          </Pane>
        </div>
      {/if}
    {/if}
  </Pane>
</fieldset>

<style>
  h4 { margin: 8px 0 4px; }
  .rowflex { margin: 4px 0; }
  .override { margin-top: 8px; scroll-margin-top: 8px; }
  .sides { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 6px 0; }
  .sides > div { min-width: 0; }
  @media (max-width: 760px) {
    .sides { grid-template-columns: 1fr; }
  }
</style>
