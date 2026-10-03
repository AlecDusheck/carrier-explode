<script lang="ts">
  import { getBaseband } from "#lib/api/tables.remote.ts";
  import { modemHref } from "#lib/format.ts";
  import Pane from "#lib/components/Pane.svelte";
  import Variants from "#lib/components/Variants.svelte";

  let { params } = $props();
</script>

<div class="scroll pad">
  <Pane>
    {@const bb = await getBaseband({ build: params.build, family: params.family })}
    <p class="dimtext note">Plaintext EFS files the package writes. A repeated path has one copy per platform or config.</p>
    <div class="hscroll">
      <table class="grid">
        <thead><tr><th>Path</th><th>From</th><th>Serves</th></tr></thead>
        <tbody>
          {#each bb.files.filter((f) => f.readable) as f (f.i)}
            <tr>
              <td class="wrap">
                <a class="mono" href={modemHref(params.build, params.family, `policy/${f.i}`)}>{f.path}</a>
                {#if f.refs?.policy}<span class="tag">{f.refs.policy}</span>{/if}
              </td>
              <td class="mono">{f.member}</td>
              <td><Variants variants={f.variants} configs={f.configs} /></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </Pane>
</div>
