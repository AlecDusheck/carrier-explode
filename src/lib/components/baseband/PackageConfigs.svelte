<script lang="ts">
  import { humanBytes, shortHex } from "$lib/format";
  import Confidence from "../Confidence.svelte";
  import Variants from "../Variants.svelte";
  import type { Baseband } from "./types";

  let { bb }: { bb: Pick<Baseband, "modemConfigs" | "containers" | "images" | "nv" | "members" | "package"> } = $props();
</script>

<fieldset class="hgroup" id="configs">
  <legend>Modem configs and containers</legend>
  {#if bb.modemConfigs}
    <h4>Built into the modem image (qdsp6sw.mbn)</h4>
    <div class="hscroll">
      <table class="grid">
        <thead><tr><th>Label</th><th>Type</th><th>Version</th><th>Capability</th><th>Files</th></tr></thead>
        <tbody>
          {#each bb.modemConfigs as m (m.offset)}
            <tr>
              <td class="mono wrap">{m.label || "(unlabelled)"}</td>
              <td>{m.cfgType}</td>
              <td class="mono">{m.version}</td>
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
    {#if c.errors?.length}<div class="banner err">{c.member}: {c.errors.length} blobs did not decode.</div>{/if}
    <details class="more">
      <summary>What {c.member} holds ({c.fileTypes.length} blob types)</summary>
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
    </details>
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
      <summary>NV/EFS defaults ({bb.nv.length} sets)</summary>
      {#each bb.nv as n (n.member + n.blob)}
        <details class="more">
          <summary class="mono">{n.fileTypeName} · {n.records.length} items <Variants variants={n.variants} /></summary>
          <div class="hscroll">
            <table class="grid">
              <thead><tr><th>Item</th><th>What it is</th><th>Value</th></tr></thead>
              <tbody>
                {#each n.records as r, i (i)}
                  <tr>
                    <td class="mono wrap">{r.efs ?? "NV " + r.nv}</td>
                    <td class="wrap">{#if r.name}{r.name} <Confidence c={r.confidence} />{#if r.meaning}<div class="dimtext">{r.meaning}</div>{/if}{/if}</td>
                    <td class="mono wrap">{#if r.label}{r.label} <span class="dimtext">0x{shortHex(r.hex)}</span>{:else}0x{shortHex(r.hex)}{/if}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </details>
      {/each}
    </details>
  {/if}

  <details class="more">
    <summary>Package details and members ({bb.members.length})</summary>
    <div class="hscroll">
      <table class="grid">
        <tbody>
          {#if bb.package.chipId}<tr><td class="k">Chip ID</td><td class="mono">{bb.package.chipId}</td></tr>{/if}
          {#if bb.package.sblVersion}<tr><td class="k">SBL</td><td class="mono">{bb.package.sblVersion}</td></tr>{/if}
          {#if bb.package.restoreSblVersion}<tr><td class="k">Restore SBL</td><td class="mono">{bb.package.restoreSblVersion}</td></tr>{/if}
          {#each bb.members as m (m.name)}<tr><td class="mono">{m.name}</td><td class="num">{humanBytes(m.size)}</td></tr>{/each}
        </tbody>
      </table>
    </div>
  </details>
</fieldset>
