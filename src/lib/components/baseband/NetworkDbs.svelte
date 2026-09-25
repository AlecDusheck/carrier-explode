<script lang="ts">
  import type { ArfcnRange, BasebandSummary, MccScanEntry } from "$lib/decode";
  import { bundleHref, shortHex } from "$lib/format";
  import Confidence from "../Confidence.svelte";
  import Variants from "../Variants.svelte";
  import type { Baseband } from "./types";

  let { mdb, mccs }: { mdb: NonNullable<BasebandSummary["mdb"]>; mccs: Baseband["mccs"] } = $props();

  const scans = $derived(mdb.databases.filter((d) => d.scan));
  const feats = $derived(mdb.databases.filter((d) => d.features));
  const failed = $derived(mdb.databases.filter((d) => d.error));

  /** Rows that differ only by the database's second key share one row. */
  function mergeScan(xs: MccScanEntry[]) {
    const out: Array<MccScanEntry & { keys: number[] }> = [];
    for (const e of xs) {
      const hit = out.find((o) => o.mcc === e.mcc && JSON.stringify(o.ranges) === JSON.stringify(e.ranges));
      if (hit) hit.keys.push(e.key);
      else out.push({ ...e, keys: [e.key] });
    }
    return out;
  }
  const mhz = (r: ArfcnRange) => `${r.loMHz}–${r.hiMHz}`;
  const dbName = (p: string) => p.split("/").pop();
  const bundlesFor = (plmns: string[]) => [...new Set(plmns.flatMap((p) => mdb.plmnBundles?.[p] ?? []))];
</script>

<fieldset class="hgroup" id="networks">
  <legend>Network databases</legend>
  <p class="dimtext note">EFS databases (/mdb) and small settings in the modem's built-in configs.</p>
  {#each scans as d (d.sha1)}
    <h4>Where 5G looks, by country <span class="dimtext mono">{dbName(d.path)}</span></h4>
    <p class="dimtext note">NR frequency ranges the modem scans or allows per country (NR-ARFCN, converted to MHz). The band is named only where a single band holds every range.</p>
    <div class="hscroll">
      <table class="grid">
        <thead><tr><th>Country</th><th>Band</th><th>Range (MHz)</th><th>NR-ARFCN</th><th class="num">Key</th></tr></thead>
        <tbody>
          {#each mergeScan(d.scan ?? []) as e, ei (ei)}
            {#each e.ranges as r, ri (ri)}
              <tr>
                {#if ri === 0}
                  <td rowspan={e.ranges.length}>{#if e.mcc}{e.mcc} {mccs[e.mcc]?.name ?? ""}{:else}Any country{/if}</td>
                  <td rowspan={e.ranges.length} class="mono">{e.band ? "n" + e.band : ""}</td>
                {/if}
                <td class="mono">{mhz(r)}{#if r.uplink}<span class="dimtext sp">uplink</span>{/if}</td>
                <td class="mono dimtext">{r.lo}–{r.hi}</td>
                {#if ri === 0}<td rowspan={e.ranges.length} class="num mono dimtext">{e.keys.join(", ")}</td>{/if}
              </tr>
            {/each}
          {/each}
        </tbody>
      </table>
    </div>
    <div class="rowflex dimtext"><span>Key: meaning unknown, not a band number.</span><Confidence c="unknown" /> <span>Serves</span> <Variants variants={d.variants} configs={d.configs} /></div>
  {/each}
  {#if feats.length}
    <h4>Features per network <Confidence c="unknown" /></h4>
    <p class="dimtext note">plmn2features records: feature id = value pairs per network. The firmware does not name the ids (they are not band numbers).</p>
    <div class="hscroll">
      <table class="grid">
        <thead><tr><th>Networks</th><th>Database</th><th>Features</th></tr></thead>
        <tbody>
          {#each feats as d (d.sha1)}
            {#each d.features ?? [] as x, xi (xi)}
              {@const bundles = bundlesFor(x.plmns)}
              <tr>
                <td class="countries">
                  {#each x.plmns as p (p)}<span class="chip mono">{p}</span>{/each}
                  {#if bundles.length}<div>{#each bundles as n (n)}<a class="chip" href={bundleHref("carriers", n)}>{n}</a>{/each}</div>{/if}
                </td>
                <td class="mono">{dbName(d.path)}</td>
                <td class="mono wrap">
                  {#if x.features}{#each x.features as [fid, v], i (i)}<span class="pair">{fid}={v}</span> {/each}
                  {:else}<span class="dimtext">raw</span> {x.hex}{/if}
                </td>
              </tr>
            {/each}
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
  {#if mdb.settings.length}
    <h4>Modem settings</h4>
    <div class="hscroll">
      <table class="grid">
        <thead><tr><th>Setting</th><th>Value</th><th>Serves</th></tr></thead>
        <tbody>
          {#each mdb.settings as x (x.sha1 + x.path)}
            <tr>
              <td class="wrap">{x.name} <Confidence c={x.confidence} /><div class="mono dimtext">{x.path}</div></td>
              <td class="wrap">{x.value} <span class="mono dimtext">0x{shortHex(x.hex)}</span></td>
              <td><Variants variants={x.variants} configs={x.configs?.filter((c) => c !== x.path)} /></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
  {#each failed as d (d.sha1)}
    <div class="banner err">{d.path}: {d.error}</div>
  {/each}
</fieldset>

<style>
  .pair { white-space: nowrap; }
  td.countries { max-width: 360px; }
  @media (max-width: 760px) {
    td.countries { min-width: 12em; }
  }
</style>
