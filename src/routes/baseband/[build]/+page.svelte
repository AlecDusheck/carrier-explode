<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { SvelteSet } from "svelte/reactivity";
  import {
    getBaseband, getBasebandBuilds, getBasebandCombos, getBasebandDiff, getBasebandFile,
  } from "$lib/api/tables.remote";
  import type { Variant } from "$lib/decode/bbfw";
  import { bundleHref, humanBytes, link, withParams } from "$lib/format";
  import Pane from "$lib/components/Pane.svelte";
  import Variants from "$lib/components/Variants.svelte";
  import Confidence from "$lib/components/Confidence.svelte";
  import ComboTable from "$lib/components/ComboTable.svelte";
  import PolicyTree from "$lib/components/PolicyTree.svelte";
  import BasebandDiff from "$lib/components/BasebandDiff.svelte";

  let { params } = $props();

  const SECTIONS = [["carriers", "Carriers"], ["policy", "Policy files"], ["power", "Power"], ["configs", "Configs"], ["diff", "Diff"]];

  const fileAt = $derived(page.url.searchParams.get("file"));
  const vs = $derived(page.url.searchParams.get("vs"));
  const combos = new SvelteSet<string>();
  let raw = $state(false);
  let powerSet = $state(0);
  let powerQuery = $state("");

  const nav = (changes: Record<string, string | null>, hash = "") =>
    goto(withParams(page.url, changes) + hash, { replaceState: true, keepFocus: true, noScroll: true });
  const toggle = (k: string) => (combos.has(k) ? combos.delete(k) : combos.add(k));
  const bands = (xs: number[], p: string) => xs.map((b) => p + b).join(" ");

  /** Platforms whose numbers for a carrier match share one row. */
  function mergeSets<S extends { sha1: string; variants: Variant[] }, C extends { tag: string; plmns: string[] }>(xs: Array<{ set: S; c: C }>) {
    const out: Array<{ sha1: string; variants: Variant[]; c: C; key: string }> = [];
    for (const { set, c } of xs) {
      const { tag: _t, plmns: _p, ...stats } = c;
      const key = JSON.stringify(stats);
      const hit = out.find((o) => o.key === key);
      if (hit) hit.variants = [...hit.variants, ...set.variants].sort((a, b) => a.platform - b.platform || a.sku - b.sku);
      else out.push({ sha1: set.sha1, variants: [...set.variants], c, key });
    }
    return out;
  }
</script>

<div class="view">
  <div class="toolbar">
    <Pane quiet>
      {@const all = await getBasebandBuilds()}
      <label class="lbl">
        Image
        <select name="build" value={params.build} onchange={(e) => goto(link("/baseband/" + e.currentTarget.value))}>
          {#if !all.some((b) => b.build === params.build)}<option value={params.build}>{params.build}</option>{/if}
          {#each all as b (b.build)}
            <option value={b.build} disabled={!b.has && b.build !== params.build}>iOS {b.version} ({b.build}){b.has ? "" : " - not extracted"}</option>
          {/each}
        </select>
      </label>
    </Pane>
    <span class="grow"></span>
    {#each SECTIONS as [id, label] (id)}<a class="btn" href="#{id}">{label}</a>{/each}
  </div>

  <div class="scroll pad">
    <Pane>
      {@const bb = await getBaseband(params.build)}
      {@const tags = [...new Set(bb.bandCombos.flatMap((s) => s.carriers.map((c) => c.tag)))]}
      {@const readable = bb.files.filter((f) => f.readable)}
      {@const others = (await getBasebandBuilds()).filter((b) => b.has && b.build !== params.build)}

      <div class="rowflex">
        <a class="btn" href={link("/releases/" + params.build)}>{bb.version ? `iOS ${bb.version}` : params.build}</a>
        <b>{bb.package.name ?? "Baseband package"}</b>
        <span class="dimtext">
          {[
            bb.package.version && "version " + bb.package.version,
            bb.package.chipId && "chip " + bb.package.chipId,
            bb.package.sblVersion && "SBL " + bb.package.sblVersion,
            bb.package.restoreSblVersion && "restore SBL " + bb.package.restoreSblVersion,
          ].filter(Boolean).join(" · ")}
        </span>
      </div>
      <p class="lead dimtext order">
        Load order: the modem's built-in config, then the per-platform defaults in bbcfg.mbn, then the carrier bundle's .der.pri, which overwrites the same EFS paths.
      </p>

      <fieldset class="hgroup" id="carriers">
        <legend>Carriers with band combos ({tags.length})</legend>
        <p class="dimtext note">From band_combos_per_plmn.xml. Bundles are the ones the OTA manifest routes those PLMNs to.</p>
        <div class="rowflex taglinks">{#each tags as t (t)}<a class="chip" href="#{t}">{t}</a>{/each}</div>
        {#each tags as tag (tag)}
          {@const m = bb.carrierMap?.[tag]}
          {@const sets = mergeSets(bb.bandCombos.flatMap((s) => s.carriers.filter((c) => c.tag === tag).map((c) => ({ set: s, c }))))}
          <section class="carrier" id={tag}>
            <h3>{tag}</h3>
            <div class="rowflex">
              <span class="dimtext">PLMN</span>
              {#each m?.plmns ?? sets[0]?.c.plmns ?? [] as p (p)}<span class="chip mono">{p}</span>{/each}
            </div>
            {#if m}
              <div class="rowflex">
                <span class="dimtext">Bundles</span>
                {#each m.bundles as n (n)}<a class="chip" href={bundleHref("carriers", n)}>{n}</a>{:else}<span class="dimtext">none mapped</span>{/each}
              </div>
              {#if m.mvnoBundles.length}
                <details>
                  <summary class="dimtext">{m.mvnoBundles.length} MVNO bundles on these PLMNs</summary>
                  {#each m.mvnoBundles as n (n)}<a class="chip" href={bundleHref("carriers", n)}>{n}</a>{/each}
                </details>
              {/if}
            {/if}
            <div class="hscroll">
              <table class="grid">
                <thead>
                  <tr>
                    <th>Platforms</th><th class="num">Combos</th><th class="num">EN-DC</th><th class="num">NR</th><th class="num">LTE</th>
                    <th class="num">NR-DC</th><th class="num">Max CC</th><th>NR bands</th><th>LTE anchors</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {#each sets as set (set.sha1)}
                    {@const c = set.c}
                    <tr>
                      <td class="plat"><Variants variants={set.variants} /></td>
                      <td class="num">{c.combos}</td>
                      <td class="num">{c.endc}</td>
                      <td class="num">{c.nr}</td>
                      <td class="num">{c.lte}</td>
                      <td class="num">{c.nrdc}</td>
                      <td class="num">{c.maxComponents}</td>
                      <td class="mono bands">{bands(c.nrBands.filter((b) => b < 257), "n")}{#if c.fr2Bands.length}<br /><span class="dimtext">FR2</span> {bands(c.fr2Bands, "n")}{/if}</td>
                      <td class="mono bands">{bands(c.lteAnchors, "B")}</td>
                      <td>
                        <button class="btn" class:on={combos.has(tag + set.sha1)} aria-expanded={combos.has(tag + set.sha1)} onclick={() => toggle(tag + set.sha1)}>Combos</button>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
            {#each sets as set (set.sha1)}
              {#if combos.has(tag + set.sha1)}
                <Pane>
                  <ComboTable combos={await getBasebandCombos({ build: params.build, sha1: set.sha1, tag })} />
                </Pane>
              {/if}
            {/each}
          </section>
        {:else}
          <p class="dimtext">No band_combos_per_plmn.xml in this package.</p>
        {/each}
      </fieldset>

      <fieldset class="hgroup" id="policy">
        <legend>Policy files ({readable.length})</legend>
        <p class="dimtext note">Plaintext EFS files the package writes. Where a path appears more than once, each copy serves the platforms or configs shown.</p>
        <div class="hscroll">
          <table class="grid">
            <thead><tr><th>Path</th><th>From</th><th>Serves</th><th class="num">Size</th></tr></thead>
            <tbody>
              {#each readable as f (f.i)}
                <tr class:sel={fileAt === String(f.i)}>
                  <td class="wrap">
                    <a class="mono" href="{withParams(page.url, { file: String(f.i) })}#file" data-sveltekit-noscroll data-sveltekit-replacestate>{f.path}</a>
                    {#if f.refs?.policy}<span class="tag">{f.refs.policy}</span>{/if}
                  </td>
                  <td class="mono">{f.member}</td>
                  <td><Variants variants={f.variants} configs={f.configs} /></td>
                  <td class="num">{humanBytes(f.length)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>

        {#if fileAt !== null}
          <div id="file" class="viewer">
            <Pane>
              {@const f = await getBasebandFile({ build: params.build, i: Number(fileAt) })}
              <div class="rowflex">
                <b class="mono wrap">{f.path}</b>
                <span class="dimtext">{f.format}, {f.member}, {humanBytes(f.length)}</span>
                <span class="grow"></span>
                {#if f.format === "xml"}
                  <button class="btn" class:on={!raw} onclick={() => (raw = false)}>Rules</button>
                  <button class="btn" class:on={raw} onclick={() => (raw = true)}>Raw</button>
                {/if}
                <button class="btn" onclick={() => nav({ file: null })}>Close</button>
              </div>
              {#if f.refs?.carriers?.length || f.refs?.plmns?.length || f.refs?.mccs?.length}
                <div class="rowflex refs">
                  {#each f.refs.carriers ?? [] as c, i (i)}<span class="chip">{c}</span>{/each}
                  {#if f.refs.plmns?.length}<span class="dimtext">{f.refs.plmns.length} PLMNs</span>{/if}
                  {#if f.refs.mccs?.length}<span class="dimtext">MCC {f.refs.mccs.join(" ")}</span>{/if}
                </div>
              {/if}
              {#if f.format === "xml" && !raw && f.text}
                <PolicyTree xml={f.text} />
              {:else if f.text !== undefined}
                <pre class="code">{f.text}</pre>
              {:else}
                <p class="dimtext">Binary content.</p>
              {/if}
            </Pane>
          </div>
        {/if}
      </fieldset>

      <fieldset class="hgroup" id="power">
        <legend>Power: A-MPR network signalling</legend>
        {#if bb.amprNs.length}
          {@const a = bb.amprNs[Math.min(powerSet, bb.amprNs.length - 1)]}
          {@const pq = powerQuery.trim().toLowerCase()}
          {@const country = (mcc: string) => bb.mccs[mcc]}
          {@const groups = a.groups.filter((g) => !pq || g.mccs.some((m) => m.includes(pq) || (country(m)?.name ?? "").toLowerCase().includes(pq)))}
          <p class="dimtext note">pt.mbn NV 64628: the NS value signalled per LTE band, without and with carrier aggregation, by MCC.</p>
          <div class="rowflex" style="margin-bottom:6px">
            {#if bb.amprNs.length > 1}
              <label class="lbl">
                Table
                <select name="ampr" bind:value={powerSet}>
                  {#each bb.amprNs as x, i (x.sha1)}
                    <option value={i}>{i + 1}: {x.variants.length} variants, platforms {[...new Set(x.variants.map((v) => v.platform))].join(", ")}</option>
                  {/each}
                </select>
              </label>
            {/if}
            <input class="grow" style="min-width:10em" type="search" name="ampr-filter" placeholder="MCC or country" aria-label="filter by MCC or country" bind:value={powerQuery} />
          </div>
          <div class="hscroll">
            <table class="grid">
              <thead><tr><th>Countries</th><th class="num">Band</th><th class="num">NS</th><th class="num">NS with CA</th></tr></thead>
              <tbody>
                {#each groups as g, gi (gi)}
                  {#each g.bands as b, bi (bi)}
                    <tr>
                      {#if bi === 0}
                        {@const named = g.mccs.map((m) => ({ m, c: country(m) }))}
                        <td rowspan={g.bands.length} class="countries">
                          {#if named.length > 8}
                            <details>
                              <summary>{named.length} MCCs: {[...new Set(named.map((x) => x.c?.name ?? x.m))].slice(0, 4).join(", ")}, …</summary>
                              {#each named as x (x.m)}<span class="chip" title={x.c?.name}>{x.m} {x.c?.cc.toUpperCase() ?? ""}</span>{/each}
                            </details>
                          {:else}
                            {#each named as x (x.m)}<span class="chip" title={x.c?.name}>{x.m} {x.c?.name ?? ""}</span>{/each}
                          {/if}
                        </td>
                      {/if}
                      <td class="num mono">B{b.band}</td>
                      <td class="num">{b.nsNoCa ?? ""}</td>
                      <td class="num">{b.nsWithCa ?? ""}</td>
                    </tr>
                  {/each}
                {:else}
                  <tr><td colspan="4" class="dimtext">No group matches.</td></tr>
                {/each}
              </tbody>
            </table>
          </div>
          <div class="rowflex" style="margin-top:4px"><span class="dimtext">Serves</span> <Variants variants={a.variants} /></div>
        {:else}
          <p class="dimtext">No A-MPR NS table in this package.</p>
        {/if}
      </fieldset>

      <fieldset class="hgroup" id="configs">
        <legend>Modem configs and containers</legend>
        {#if bb.modemConfigs}
          <h4>Built into the modem image (qdsp6sw.mbn)</h4>
          <div class="hscroll">
            <table class="grid">
              <thead><tr><th>Label</th><th>Type</th><th>Stored</th><th>Version</th><th>Trailer</th><th>Capability</th><th>Files</th></tr></thead>
              <tbody>
                {#each bb.modemConfigs as m (m.offset)}
                  <tr>
                    <td class="mono wrap">{m.label || "(unlabelled)"}</td>
                    <td>{m.cfgType}</td>
                    <td class="mono">{m.container} @{m.offset.toString(16)}</td>
                    <td class="mono">{m.version}</td>
                    <td class="mono">{m.trailer?.version ?? ""}{m.trailer?.baseVersion && m.trailer.baseVersion !== m.trailer.version ? ` base ${m.trailer.baseVersion}` : ""}</td>
                    <td class="mono">{m.trailer?.capability ?? ""}</td>
                    <td>
                      <details>
                        <summary>{m.files.length}</summary>
                        {#each m.files as p, i (i)}<div class="mono wrap">{p}</div>{/each}
                      </details>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}

        {#each bb.containers as c (c.member)}
          <h4>{c.member} <span class="dimtext">({c.magic}, {c.records} index records, {c.blobs} blobs{c.meta.version ? `, ${c.meta.project ?? ""} ${c.meta.version}` : ""})</span></h4>
          {#if c.errors?.length}<div class="banner err">{c.errors.length} blobs did not decode.</div>{/if}
          <div class="hscroll">
            <table class="grid">
              <thead><tr><th class="num">Type</th><th>Name</th><th class="num">Blobs</th><th class="num">Records</th><th>Holds</th></tr></thead>
              <tbody>
                {#each c.fileTypes as t (t.type)}
                  <tr>
                    <td class="num">{t.type}</td>
                    <td class="mono">{t.name}<Confidence c={t.confidence} /></td>
                    <td class="num">{t.blobs}</td>
                    <td class="num">{t.records}</td>
                    <td class="dimtext">{t.note ?? ""}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/each}

        {#if bb.images.length}
          <details class="more">
            <summary>MCFG images in the containers ({bb.images.length})</summary>
            <div class="hscroll">
              <table class="grid">
                <thead><tr><th>Blob</th><th>Type</th><th>Serves</th><th>Cfg</th><th>Version</th><th>Label</th><th class="num">Files</th></tr></thead>
                <tbody>
                  {#each bb.images as im (im.member + im.blob)}
                    <tr>
                      <td class="mono">{im.member} #{im.blob}</td>
                      <td class="mono">{im.fileTypeName}</td>
                      <td><Variants variants={im.variants} /></td>
                      <td>{im.cfgType}</td>
                      <td class="mono">{im.trailer?.version ?? im.version}</td>
                      <td class="mono wrap">{im.trailer?.label ?? ""}</td>
                      <td class="num">{im.files.length}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          </details>
        {/if}

        {#if bb.nv.length}
          <details class="more">
            <summary>Protocol NV/EFS blobs ({bb.nv.length})</summary>
            <div class="hscroll">
              <table class="grid">
                <thead><tr><th>Blob</th><th>Type</th><th>Serves</th><th class="num">Records</th></tr></thead>
                <tbody>
                  {#each bb.nv as n (n.member + n.blob)}
                    <tr>
                      <td class="mono">{n.member} #{n.blob}</td>
                      <td class="mono">{n.fileTypeName}</td>
                      <td><Variants variants={n.variants} /></td>
                      <td class="num">{n.records}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          </details>
        {/if}

        <details class="more">
          <summary>Package members ({bb.members.length})</summary>
          <div class="hscroll">
            <table class="grid">
              <tbody>
                {#each bb.members as m (m.name)}<tr><td class="mono">{m.name}</td><td class="num">{humanBytes(m.size)}</td></tr>{/each}
              </tbody>
            </table>
          </div>
        </details>
      </fieldset>

      <fieldset class="hgroup" id="diff">
        <legend>Diff against another image</legend>
        {#if others.length}
          <label class="lbl">
            Before
            <select name="vs" value={vs ?? ""} onchange={(e) => nav({ vs: e.currentTarget.value || null }, "#diff")}>
              <option value="">Pick an image</option>
              {#each others as b (b.build)}<option value={b.build}>iOS {b.version} ({b.build})</option>{/each}
            </select>
          </label>
          {#if vs}
            <Pane>
              {@const d = await getBasebandDiff({ a: vs, b: params.build })}
              <p class="dimtext note">
                iOS {d.a.version ?? d.a.build} ({d.a.build}) to iOS {d.b.version ?? d.b.build} ({d.b.build}):
                {d.counts.changed} changed, {d.counts.added} added, {d.counts.removed} removed.
              </p>
              <BasebandDiff parts={d.parts} />
            </Pane>
          {/if}
        {:else}
          <p class="dimtext">No other image has a baseband summary yet.</p>
        {/if}
      </fieldset>
    </Pane>
  </div>
</div>

<style>
  .order { margin: 6px 0 0; }
  .note { margin: 0 0 6px; }
  .carrier { border-top: 1px solid var(--shadow); padding: 6px 0; scroll-margin-top: 8px; }
  .carrier h3 { margin: 0 0 4px; font-size: 13px; }
  .carrier .rowflex { margin-bottom: 4px; }
  .carrier details { margin-bottom: 4px; }
  h4 { margin: 8px 0 4px; }
  .viewer { margin-top: 8px; scroll-margin-top: 8px; }
  .refs { margin: 4px 0; }
  tr.sel td { background: #e3ebf5; }
  td.countries { max-width: 360px; }
  .more { margin-top: 8px; }
  .more > summary { cursor: pointer; padding: 4px 0; }
  fieldset[id] { scroll-margin-top: 8px; }
  td.bands { min-width: 14em; }
  td.plat { white-space: nowrap; }
  @media (max-width: 760px) {
    .taglinks .chip { padding: 5px 8px; }
    td.countries { min-width: 12em; }
  }
</style>
