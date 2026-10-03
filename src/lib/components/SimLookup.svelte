<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { getPlmn } from "#lib/api/tables.remote.ts";
  import { bundleHref, withParams } from "#lib/format.ts";
  import type { MccMncEntry } from "#lib/server/manifest.ts";

  const LIMIT = 200;

  // The box owns what is typed; the URL only mirrors it, so a link shares the search.
  let q = $state(page.url.searchParams.get("q") ?? "");

  type Sim = { plmn: string; gid1?: string; gid2?: string; iccid?: string };
  type Rule = MccMncEntry["mvnos"][number];

  /** "310410", "310-410 gid1 42", "20404 iccid 891480 gid2 1a": a SIM to resolve; anything else is a name search. */
  function parseSim(raw: string): Sim | undefined {
    const m = /^(\d{3})[\s-]?(\d{2,3})(?![\d])(.*)$/.exec(raw.trim());
    if (!m) return undefined;
    const sim: Sim = { plmn: m[1] + m[2] };
    for (const [, key, value] of m[3].matchAll(/\b(gid1|gid2|iccid)\s*[=:]?\s*([0-9a-f]+)/gi)) {
      sim[key.toLowerCase() as "gid1" | "gid2" | "iccid"] = value.toUpperCase();
    }
    return sim;
  }

  /** A rule matches when the SIM's value for every field the rule names starts with the rule's value. */
  const ruleMatches = (r: Rule, sim: Sim) =>
    (!!r.gid1 || !!r.gid2 || !!r.iccid) &&
    (!r.gid1 || !!sim.gid1?.startsWith(r.gid1.toUpperCase())) &&
    (!r.gid2 || !!sim.gid2?.startsWith(r.gid2.toUpperCase())) &&
    (!r.iccid || !!sim.iccid?.startsWith(r.iccid.toUpperCase()));

  const ruleText = (m: Rule) =>
    [m.gid1 && "GID1 " + m.gid1, m.gid2 && "GID2 " + m.gid2, m.iccid && "ICCID " + m.iccid + "…"].filter(Boolean).join(", ");

  const sim = $derived(parseSim(q));
  const text = $derived(q.trim().toLowerCase().replace(/[^a-z0-9]/g, ""));
</script>

<fieldset class="hgroup">
  <legend>Find the bundle for a SIM</legend>
  <p class="dimtext note">
    An MCC-MNC (<span class="mono">310410</span>), optionally with the SIM's group identifier or ICCID
    (<span class="mono">310410 gid1 42</span>, <span class="mono">20404 iccid 891480</span>), an ICCID prefix, or a bundle name.
    MVNO rules under an MCC-MNC are checked first, then its plain entry.
  </p>
  <div class="filters">
    <input
      class="grow"
      type="search"
      name="q"
      placeholder="310410 gid1 42"
      aria-label="find a bundle by MCC-MNC, GID, ICCID prefix or name"
      bind:value={q}
      oninput={() => goto(withParams(page.url, { q: q || null }), { replace: true, shallow: true })}
    />
  </div>
  {#if text}
    {@const t = await getPlmn()}
    {@const nets = sim
      ? t.entries.filter((e) => e.plmn === sim.plmn)
      : t.entries.filter((e) => e.plmn.startsWith(text) || (e.bundle ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").includes(text) ||
          e.mvnos.some((m) => m.bundle.toLowerCase().replace(/[^a-z0-9]/g, "").includes(text) || (m.iccid ?? "").startsWith(text)))}
    {@const iccids = sim ? [] : t.iccids.filter(([k, v]) => k.startsWith(text) || text.startsWith(k) || v.toLowerCase().includes(text))}
    {@const ids = sim ? [] : t.carrierIds.filter(([k, v]) => k.toLowerCase().includes(text) || v.toLowerCase().includes(text))}

    {#if sim && (sim.gid1 || sim.gid2 || sim.iccid)}
      {@const e = nets[0]}
      {@const hits = e ? e.mvnos.filter((m) => ruleMatches(m, sim)) : []}
      <p class="note">
        {#if !e}
          No bundle is listed for MCC-MNC {sim.plmn}.
        {:else if hits.length}
          This SIM loads <a href={bundleHref("carriers", hits[0].bundle)}><b>{hits[0].bundle}</b></a>, by the MVNO rule {ruleText(hits[0])}.
          {#if hits.length > 1}<span class="dimtext">{hits.length - 1} more rule{hits.length > 2 ? "s" : ""} match too; which one iOS prefers is not known.</span>{/if}
        {:else if e.bundle}
          No MVNO rule matches, so this SIM loads <a href={bundleHref("carriers", e.bundle)}><b>{e.bundle}</b></a>, the plain entry for {sim.plmn}.
        {:else}
          No MVNO rule matches and {sim.plmn} has no plain entry: iOS finds no bundle for this SIM here.
        {/if}
      </p>
    {/if}

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
                <div class:hit={!!sim && ruleMatches(m, sim)}><a href={bundleHref("carriers", m.bundle)}>{m.bundle}</a> <span class="dimtext">{ruleText(m)}</span></div>
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
    {#if nets.some((e) => e.mvnos.some((m) => /^F+$/i.test(m.gid1 ?? "")))}
      <p class="dimtext note">GID1 <span class="mono">FFFF</span> is how a SIM reads when its operator never set a group identifier, so those rules presumably take the operator's own SIMs.</p>
    {/if}
  {/if}
</fieldset>

<style>
  .hit { background: var(--sel-row); }
</style>
