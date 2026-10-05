<script lang="ts">
  import { getBaseband, getBasebandFile } from "#lib/api/apple.remote.ts";
  import { humanBytes, modemHref } from "#lib/format.ts";
  import type { ModemProps } from "../../views.ts";
  import Pane from "../../Pane.svelte";
  import PolicyTree from "../../modem/PolicyTree.svelte";
  import Variants from "../Variants.svelte";

  /** The package's plaintext EFS files, or one of them by its index (`path`). */
  let { build, modem, path }: ModemProps & { path: string } = $props();

  let source = $state(false);
</script>

<div class="scroll pad">
  <Pane>
    {@const bb = await getBaseband({ build, family: modem })}
    {#if path}
      {@const f = await getBasebandFile({ id: bb.id, i: Number(path) })}
      <div class="filters">
        <span class="mono breakall">{f.path}</span>
        <span class="dimtext">{f.format}, {f.member}, {humanBytes(f.length)}</span>
      </div>
      {#if f.refs?.carriers?.length || f.refs?.plmns?.length || f.refs?.mccs?.length}
        <div class="filters">
          {#each f.refs.carriers ?? [] as c, i (i)}<span class="chip">{c}</span>{/each}
          {#if f.refs.plmns?.length}<span class="dimtext">{f.refs.plmns.length} PLMNs</span>{/if}
          {#if f.refs.mccs?.length}<span class="dimtext">MCC {f.refs.mccs.join(" ")}</span>{/if}
        </div>
      {/if}
      {#if f.format === "xml" && f.text}
        <PolicyTree xml={f.text} />
        <button class="chip" onclick={() => (source = !source)}>{source ? "hide" : "show"} source</button>
        {#if source}<pre class="code">{f.text}</pre>{/if}
      {:else if f.text !== undefined}
        <pre class="code">{f.text}</pre>
      {:else}
        <p class="dimtext">Binary content.</p>
      {/if}
    {:else}
      <p class="dimtext note">Plaintext EFS files the package writes. A repeated path has one copy per platform or config.</p>
      <div class="hscroll">
        <table class="grid">
          <thead><tr><th>Path</th><th>From</th><th>Serves</th></tr></thead>
          <tbody>
            {#each bb.files.filter((f) => f.readable) as f (f.i)}
              <tr>
                <td>
                  <a class="mono" href={modemHref("ios", build, modem, `policy/${f.i}`)}>{f.path}</a>
                  {#if f.refs?.policy}<span class="tag">{f.refs.policy}</span>{/if}
                </td>
                <td class="mono">{f.member}</td>
                <td><Variants variants={f.variants} configs={f.configs} /></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </Pane>
</div>
