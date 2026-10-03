<script lang="ts">
  import { getBasebandBuilds } from "#lib/api/tables.remote.ts";
  import { modemLabel } from "#lib/decode/index.ts";
  import { link } from "#lib/format.ts";
  import Pane from "#lib/components/Pane.svelte";
</script>

<div class="view">
  <div class="scroll pad">
    <Pane>
      {@const builds = await getBasebandBuilds()}
      <fieldset class="hgroup">
        <legend>iOS builds ({builds.length})</legend>
        <p class="dimtext note">Each image's bundle changes and the modem packages it ships: the defaults every carrier bundle starts from.</p>
        <table class="grid">
          <thead><tr><th>iOS</th><th>Build</th><th>Modem packages</th></tr></thead>
          <tbody>
            {#each builds as b (b.build)}
              <tr>
                <td class="k"><a href={link("/builds/" + b.build)}>iOS {b.version}</a></td>
                <td class="mono">{b.build}</td>
                <td>
                  {#each b.families as f, i (f)}{#if i}, {/if}<a href={link(`/builds/${b.build}/${f}`)}>{modemLabel(f)}</a>{:else}<span class="dimtext">not extracted</span>{/each}
                </td>
              </tr>
            {:else}
              <tr><td colspan="3" class="dimtext">No images held.</td></tr>
            {/each}
          </tbody>
        </table>
      </fieldset>
    </Pane>
  </div>
</div>
