<script lang="ts">
  import { SSGCCS_STATES, type BasebandSsgccs, type SsgccsLine } from "$lib/decode";
  import Confidence from "../Confidence.svelte";
  import Variants from "../Variants.svelte";

  let { groups }: { groups: BasebandSsgccs[] } = $props();
</script>

{#snippet fields(line: SsgccsLine, keyed: boolean)}
  <h4>{line.title}{#if keyed}<span class="dimtext mono sp">{line.key}</span>{/if}</h4>
  <div class="hscroll">
    <table class="grid fit">
      <tbody>
        {#each line.fields as f, i (i)}
          <tr>
            <td class="k">{f.name}</td>
            <td class="mono">{f.value}{#if f.meaning}<span class="dimtext sp">({f.meaning})</span>{/if}</td>
            <td><Confidence c={f.confidence} /></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/snippet}

<fieldset class="hgroup" id="fbs">
  <legend>Fake base station detection</legend>
  {#each groups as g, gi (gi)}
    {@const cfg = g.config}
    {#if groups.length > 1}<div class="rowflex"><span class="dimtext">Serves</span> <Variants variants={g.variants} configs={g.configs} /></div>{/if}
    <p class="prose">
      The modem scores every cell it sees for signs of a fake base station (an IMSI catcher: a transmitter posing as the carrier
      to identify or track phones). As a cell's score rises it moves through {SSGCCS_STATES.join(" → ")}, and past a threshold the
      modem acts against it, for example by barring or deprioritising that cell.
      {#if cfg.allNetworks}<b>This package turns it on for all networks.</b>{:else if cfg.plmns.length}It is on for {cfg.plmns.join(", ")}.{:else}The files do not say which networks it runs on.{/if}
    </p>
    {#if cfg.custom}{@render fields(cfg.custom, false)}{/if}
    {#each [...cfg.rats, ...cfg.other] as l (l.key)}{@render fields(l, true)}{/each}
    <details class="more">
      <summary>Raw text</summary>
      {#each g.files as f (f.path)}
        <div class="mono dimtext">{f.path}</div>
        <pre class="code">{f.text}</pre>
      {/each}
    </details>
  {/each}
  <p class="dimtext note">Field names come from the modem image's key strings and log text; the parser itself is compressed.</p>
</fieldset>
