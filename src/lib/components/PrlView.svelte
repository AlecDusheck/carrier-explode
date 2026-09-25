<script lang="ts">
  import type { PrlDecoded, PrlAcqRecord, PrlSysRecord } from "$lib/decode";

  let { prl }: { prl: PrlDecoded } = $props();

  let filter = $state("");
  let all = $state(false);
  const LIMIT = 300;

  function channels(a: PrlAcqRecord): string {
    const groups: Array<{ head: string; chans: number[] }> = [];
    for (const c of a.channels ?? []) {
      const head = c.band === undefined ? "" : `BC${c.band}${c.bandName ? " (" + c.bandName + ")" : ""}: `;
      if (groups.at(-1)?.head !== head) groups.push({ head, chans: [] });
      groups.at(-1)!.chans.push(c.channel);
    }
    return groups.map((g) => g.head + g.chans.join(", ")).join("; ");
  }

  function acqDetail(a: PrlAcqRecord): string {
    return [a.system, a.channelSelection && a.channelSelection + " channels", a.blocks && "blocks " + a.blocks.join(", ")]
      .filter(Boolean)
      .join("; ");
  }

  function sysExtra(s: PrlSysRecord): string {
    return [
      s.subnet && "subnet " + s.subnet,
      s.mcc && `MCC ${s.mcc} MNC ${s.mnc ?? "?"}`,
      s.subtype,
      s.sids?.length && "SIDs " + s.sids.join(", "),
      s.sidNids?.length && "SID/NID " + s.sidNids.map((x) => x.sid + "/" + x.nid).join(", "),
      s.subnetIds?.length && "subnets " + s.subnetIds.join(", "),
      s.association && `assoc tag ${s.association.tag}${s.association.pn ? ", PN" : ""}${s.association.data ? ", data" : ""}`,
      s.raw && "raw " + s.raw,
    ]
      .filter(Boolean)
      .join("; ");
  }

  const nid = (s: PrlSysRecord) =>
    s.nid === undefined ? "" : s.nid === 65535 ? "any" : String(s.nid);

  const systems = $derived.by(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return prl.systems;
    return prl.systems.filter((s) =>
      [s.sid, s.nid, s.roamIndName, s.typeName, sysExtra(s), "geo " + s.region].some((x) =>
        String(x ?? "").toLowerCase().includes(f),
      ),
    );
  });
  const shown = $derived(all ? systems : systems.slice(0, LIMIT));
</script>

{#each prl.warnings as w, i (i)}<div class="banner err">{w}</div>{/each}

<fieldset class="hgroup">
  <legend>Header</legend>
  <table class="grid">
    <tbody>
      <tr><td class="k">Format</td><td>{prl.format === "extended" ? "Extended PRL" : "IS-683-A PRL"}, SSPR_P_REV {prl.sspPRev}</td></tr>
      <tr><td class="k">PRL ID</td><td class="mono">{prl.id}</td></tr>
      <tr><td class="k">Size</td><td>{prl.size} bytes (PR_LIST_SIZE)</td></tr>
      <tr><td class="k">Preferred only</td><td>{prl.prefOnly ? "yes: only systems listed as preferred may be used" : "no: unlisted systems may be used"}</td></tr>
      <tr><td class="k">Default roaming indicator</td><td>{prl.defRoamInd} = {prl.defRoamIndName}</td></tr>
      <tr><td class="k">Records</td><td>{prl.numAcqRecs} acquisition, {prl.numSysRecs} system in {prl.regions} GEO region{prl.regions === 1 ? "" : "s"}{prl.numCommonSubnetRecs ? ", " + prl.numCommonSubnetRecs + " common subnet" : ""}</td></tr>
      <tr>
        <td class="k">CRC</td>
        <td>
          <span class="chip {prl.crc.ok ? 'good' : 'bad'}">{prl.crc.ok ? "ok" : "mismatch"}</span>
          <span class="mono dimtext">stored 0x{prl.crc.stored.toString(16).padStart(4, "0")}{prl.crc.ok ? "" : ", computed 0x" + prl.crc.computed.toString(16).padStart(4, "0")}</span>
        </td>
      </tr>
    </tbody>
  </table>
</fieldset>

<fieldset class="hgroup">
  <legend>Acquisition table ({prl.acquisition.length})</legend>
  <p class="dimtext" style="margin:0 0 6px">Where to look for a signal: band class and channels, in scan order. System records point here by index.</p>
  <table class="grid">
    <thead><tr><th class="num">#</th><th>Type</th><th>Channels</th></tr></thead>
    <tbody>
      {#each prl.acquisition as a (a.index)}
        <tr>
          <td class="num">{a.index}</td>
          <td>{a.typeName}{#if acqDetail(a)}<div class="dimtext">{acqDetail(a)}</div>{/if}</td>
          <td class="mono">{channels(a)}{#if a.raw}<span class="dimtext">raw {a.raw}</span>{/if}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</fieldset>

{#if prl.commonSubnets?.length}
  <fieldset class="hgroup">
    <legend>Common subnet table ({prl.commonSubnets.length})</legend>
    <p class="mono" style="margin:0; word-break:break-all; font-size:11px">{prl.commonSubnets.join(", ")}</p>
  </fieldset>
{/if}

<fieldset class="hgroup">
  <legend>System table ({prl.systems.length})</legend>
  <p class="dimtext" style="margin:0 0 6px">
    Networks by SID/NID, grouped into GEO regions; within a region, higher rows are preferred. Negative records are forbidden systems.
  </p>
  <div class="rowflex" style="margin-bottom:6px">
    <input class="grow" type="search" name="prl-filter" placeholder="filter SID, NID, roaming" aria-label="filter system records" bind:value={filter} />
    <span class="dimtext">{systems.length} shown</span>
  </div>
  <div class="wide">
    <table class="grid">
      <thead>
        <tr>
          <th class="num">#</th><th class="num">GEO</th><th>Use</th><th class="num">SID</th><th class="num">NID</th>
          <th class="num">Acq</th><th>Roaming indicator</th><th>Type / other</th>
        </tr>
      </thead>
      <tbody>
        {#each shown as s (s.index)}
          <tr class:newgeo={!s.geo}>
            <td class="num">{s.index}</td>
            <td class="num">{s.region}</td>
            <td>
              <span class="chip {s.preferred ? 'good' : 'bad'}">{s.preferred ? "pref" : "neg"}</span>{#if s.priority}<span class="chip" title="more desirable than the next record">pri</span>{/if}
            </td>
            <td class="num mono">{s.sid ?? ""}</td>
            <td class="num mono" title={s.nidIncl}>{nid(s)}</td>
            <td class="num">{s.acqIndex}</td>
            <td>{#if s.roamInd !== undefined}<span class="mono">{s.roamInd}</span> {s.roamIndName}{/if}</td>
            <td class="wrap">
              {#if s.type !== 0}{s.typeName}{/if}
              {#if sysExtra(s)}<div class="dimtext mono">{sysExtra(s)}</div>{/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  {#if systems.length > LIMIT}
    <button class="btn" style="margin-top:6px" onclick={() => (all = !all)}>
      {all ? "Show first " + LIMIT : "Show all " + systems.length}
    </button>
  {/if}
</fieldset>

<style>
  @media (max-width: 760px) {
    .wide { overflow-x: auto; }
    .wide table { min-width: 560px; }
  }
  tr.newgeo td { border-top: 2px solid var(--shadow); }
</style>
